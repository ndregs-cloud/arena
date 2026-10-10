import "server-only";
import { AppError } from "@/domain/errors";
import { ROLES, ROLE_LABELS, ROLE_RESTRICTIONS, type Role } from "@/domain/rbac";
import {
  emailSchema,
  loginSchema,
  normalizePhone,
  passwordSchema,
  parseOrThrow,
  registerSchema,
} from "@/domain/validation";
import { decryptSecret, encryptSecret, hashOpaque, randomToken } from "@/platform/crypto-helpers";
import { bool, date, getDb, num, text } from "@/platform/db";
import { env } from "@/platform/env";
import { log } from "@/platform/logger";
import {
  assertLoginNotThrottled,
  clearFailedLogin,
  clearSessionCookie,
  issueSessionCookie,
  loadUser,
  loginBucket,
  recordFailedLogin,
  revokeSession,
} from "@/platform/auth";
import { hashPassword, verifyPassword } from "@/platform/password";
import { generateTotpSecret, totpProvisioningUri, verifyTotp } from "@/platform/totp";
import { writeAudit } from "@/platform/audit";
import { mergeGuestCartIntoAccount } from "@/server/services/cart.service";
import type { RequestContext } from "@/server/context";

/**
 * Autentikasi (Blueprint §10.2, §13.1): daftar, masuk (rate limit + MFA TOTP), verifikasi email,
 * reset password sekali pakai (token di-hash), rotasi sesi, dan pemulihan MFA.
 * Pesan dibuat seragam agar akun tidak dapat di-enumerasi (OWASP ASVS 2.3).
 */

export interface LoginResult {
  user: {
    id: string;
    email: string;
    fullName: string;
    kind: "customer" | "staff";
    roles: Role[];
    mfaEnabled: boolean;
    emailVerified: boolean;
  };
  message: string;
}

/** Hash dummy untuk menyamakan waktu verifikasi saat email tidak dikenal. */
const DUMMY_HASH = hashPassword("kata-sandi-pancing-12345");

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

async function currentPolicyVersionLabel(key: string): Promise<string> {
  const db = await getDb();
  const res = await db.query<{ version: unknown }>(
    `SELECT version FROM policies WHERE key = $1 AND is_current = true ORDER BY version DESC LIMIT 1`,
    [key],
  );
  const version = num(res.rows[0]?.version, 1);
  return `${key}-v${version || 1}`;
}

export async function registerAccount(
  ctx: RequestContext,
  input: unknown,
): Promise<{ message: string }> {
  const data = parseOrThrow(registerSchema, input);
  const email = normalizeEmail(data.email);
  const phone = normalizePhone(data.phone);
  const db = await getDb();

  const existing = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE email_normalized = $1`,
    [email],
  );
  if (existing.rows[0]) {
    return { message: "Jika pendaftaran berhasil, tautan verifikasi akan dikirim ke email Anda." };
  }

  const storedHash = hashPassword(data.password);
  const userId = await db.transaction(async (tx) => {
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, password_algo, full_name, phone, kind, is_active)
       VALUES ($1,$2,'scrypt',$3,$4,'customer',true) RETURNING id`,
      [email, storedHash, data.fullName, phone],
    );
    const id = String(inserted.rows[0]?.id);
    await tx.query(
      `INSERT INTO customer_profiles (user_id, marketing_consent, consent_updated_at, locale, timezone, support_flag)
       VALUES ($1,$2,now(),'id-ID','Asia/Jakarta','none') ON CONFLICT (user_id) DO NOTHING`,
      [id, data.marketingConsent ?? false],
    );
    const policyVersion = await currentPolicyVersionLabel("privasi");
    await tx.query(
      `INSERT INTO consent_records (user_id, email, purpose, policy_key, policy_version, source, request_id)
       VALUES ($1,$2,'privacy','privasi',$3,'register',$4)`,
      [id, email, policyVersion, ctx.requestId],
    );
    if (data.marketingConsent) {
      await tx.query(
        `INSERT INTO consent_records (user_id, email, purpose, policy_key, policy_version, source, request_id)
         VALUES ($1,$2,'marketing','privasi',$3,'register',$4)`,
        [id, email, policyVersion, ctx.requestId],
      );
    }
    const token = randomToken(32);
    await tx.query(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1,'verify_email',$2, now() + interval '48 hours')`,
      [id, await hashOpaque(token)],
    );
    await tx.query(
      `INSERT INTO notification_outbox (kind, channel, to_address, subject, body, template, template_version, payload, requires_consent, status)
       VALUES ('verify_email','email',$1,$2,$3,'verify_email',1,'{}'::jsonb,false,'queued')`,
      [
        email,
        `Konfirmasi email ${env.appName}`,
        `${env.appName} — konfirmasi alamat email Anda: ${env.appUrl}/verifikasi-email?token=${token}\n\nTautan berlaku 48 jam.`,
      ],
    );
    return id;
  });

  await writeAudit({
    actorId: userId,
    actorEmail: email,
    actorKind: "guest",
    action: "auth.register",
    targetType: "user",
    targetId: userId,
    afterData: { email, phoneMasked: phone.slice(0, 4) + "****" + phone.slice(-2) },
    requestId: ctx.requestId,
    ipHash: ctx.ipHash,
  });

  return {
    message: "Akun dibuat. Periksa email Anda untuk menautkan alamat (tautan berlaku 48 jam).",
  };
}

export async function login(ctx: RequestContext, input: unknown): Promise<LoginResult> {
  const data = parseOrThrow(loginSchema, input);
  const email = normalizeEmail(data.identifier);
  const db = await getDb();
  const bucket = loginBucket(email, ctx.ipHash);
  await assertLoginNotThrottled(bucket);

  const res = await db.query<Record<string, unknown>>(
    `SELECT id, email, full_name, password_hash, kind, is_active, mfa_secret_enc, mfa_enabled_at, failed_login_count, locked_until, email_verified_at
       FROM users WHERE email_normalized = $1 LIMIT 1`,
    [email],
  );
  const row = res.rows[0];
  const invalid = () =>
    new AppError("UNAUTHENTICATED", "Email atau kata sandi salah.", {
      status: 401,
      details: { reason: "invalid_credentials" },
    });

  if (!row) {
    verifyPassword(data.password, DUMMY_HASH); // samakan biaya kriptografis (anti-enumerasi)
    await recordFailedLogin(bucket);
    throw invalid();
  }
  if (!bool(row.is_active)) {
    throw new AppError(
      "PERMISSION_DENIED",
      "Akun dinonaktifkan. Hubungi dukungan untuk pemulihan.",
      { status: 403, details: { reason: "account_disabled" } },
    );
  }
  const lockedUntil = date(row.locked_until);
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    throw new AppError(
      "RATE_LIMITED",
      "Akun terkunci sementara karena percobaan gagal berulang. Coba lagi nanti.",
      {
        status: 429,
        details: { reason: "account_locked", lockedUntil: lockedUntil.toISOString() },
      },
    );
  }

  if (!verifyPassword(data.password, String(row.password_hash))) {
    await recordFailedLogin(bucket);
    const attempts = num(row.failed_login_count) + 1;
    await db.query(
      `UPDATE users SET failed_login_count = $2, locked_until = CASE WHEN $2 >= $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END WHERE id = $1`,
      [
        text(row.id),
        attempts,
        env.authMaxFailedAttempts,
        String(Math.max(1, env.authLockoutMinutes)),
      ],
    );
    throw invalid();
  }

  if (row.mfa_secret_enc && row.mfa_enabled_at) {
    const code = (data.totpCode ?? "").trim();
    if (!/^\d{6}$/.test(code)) {
      throw new AppError("UNAUTHENTICATED", "Masukkan kode MFA 6 angka Anda.", {
        status: 401,
        details: { reason: "mfa_required", mfaRequired: true },
      });
    }
    const secret = await decryptSecret(String(row.mfa_secret_enc));
    if (!verifyTotp(secret, code, { window: 1 })) {
      await recordFailedLogin(bucket);
      throw new AppError("UNAUTHENTICATED", "Kode MFA tidak valid atau sudah kedaluwarsa.", {
        status: 401,
        details: { reason: "mfa_invalid" },
      });
    }
  } else if (String(row.kind) === "staff" && env.requireMfaForStaff) {
    throw new AppError(
      "PERMISSION_DENIED",
      "Akun staf wajib mengaktifkan MFA. Hubungi administrator untuk pemulihan.",
      {
        status: 403,
        details: { reason: "mfa_enrollment_required" },
      },
    );
  }

  const sessionPublicId = randomToken(20);
  await db.query(
    `INSERT INTO sessions (public_id, user_id, expires_at, ip_hash, user_agent)
     VALUES ($1,$2, now() + ($3 || ' hours')::interval,$4,$5)`,
    [
      sessionPublicId,
      text(row.id),
      String(String(row.kind) === "staff" ? env.adminSessionTtlHours : env.sessionTtlHours),
      ctx.ipHash,
      (ctx.userAgent ?? "").slice(0, 300),
    ],
  );
  await db.query(
    `UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`,
    [text(row.id)],
  );
  await clearFailedLogin(bucket);
  await issueSessionCookie(sessionPublicId, text(row.id));

  const merged = await mergeGuestCartIntoAccount(ctx).catch((error) => {
    log.warn("merge keranjang tamu gagal", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  const user = await loadUser(text(row.id));
  await writeAudit({
    actorId: text(row.id),
    actorEmail: email,
    actorKind: user?.kind === "staff" ? "staff" : "customer",
    action: "auth.login",
    targetType: "user",
    targetId: text(row.id),
    afterData: { mergedCartItems: merged?.mergedItems ?? 0 },
    requestId: ctx.requestId,
    ipHash: ctx.ipHash,
  });

  return {
    user: {
      id: text(row.id),
      email: String(row.email),
      fullName: String(row.full_name),
      kind: user?.kind ?? "customer",
      roles: user?.roles ?? [],
      mfaEnabled: Boolean(row.mfa_enabled_at),
      emailVerified: Boolean(row.email_verified_at),
    },
    message:
      merged && merged.mergedItems > 0
        ? "Berhasil masuk. Keranjang Anda dipindahkan ke akun."
        : "Berhasil masuk.",
  };
}

export async function logout(sessionPublicId: string | null): Promise<void> {
  if (sessionPublicId) await revokeSession(sessionPublicId);
  await clearSessionCookie();
}

export async function verifyEmailToken(token: string): Promise<{ message: string }> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT t.id AS token_id, t.user_id, t.expires_at, t.consumed_at, u.email_verified_at
       FROM auth_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.purpose = 'verify_email' LIMIT 1`,
    [await hashOpaque(token)],
  );
  const row = res.rows[0];
  if (!row)
    throw new AppError(
      "VALIDATION_FAILED",
      "Tautan verifikasi tidak dikenali. Ajukan ulang tautan bila perlu.",
      { status: 400 },
    );
  if (row.consumed_at)
    throw new AppError("VALIDATION_FAILED", "Tautan verifikasi sudah dipakai.", { status: 410 });
  const expiresAt = date(row.expires_at);
  if (expiresAt && expiresAt.getTime() < Date.now())
    throw new AppError("VALIDATION_FAILED", "Tautan verifikasi kedaluwarsa. Ajukan ulang tautan.", {
      status: 410,
    });
  if (row.email_verified_at) {
    await db.query(`UPDATE auth_tokens SET consumed_at = now() WHERE id = $1`, [
      text(row.token_id),
    ]);
    return { message: "Email Anda sudah terverifikasi." };
  }
  await db.transaction(async (tx) => {
    await tx.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [text(row.user_id)]);
    await tx.query(`UPDATE auth_tokens SET consumed_at = now() WHERE id = $1`, [
      text(row.token_id),
    ]);
  });
  return { message: "Email terverifikasi. Terima kasih!" };
}

export async function requestPasswordReset(
  ctx: RequestContext,
  emailRaw: string,
): Promise<{ message: string }> {
  const email = normalizeEmail(parseOrThrow(emailSchema, emailRaw.trim()));
  const db = await getDb();
  const res = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE email_normalized = $1 LIMIT 1`,
    [email],
  );
  const userId = res.rows[0]?.id;
  if (userId) {
    const token = randomToken(32);
    await db.query(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1,'reset_password',$2, now() + interval '1 hour')`,
      [userId, await hashOpaque(token)],
    );
    await db.query(
      `INSERT INTO notification_outbox (kind, channel, to_address, subject, body, template, template_version, payload, requires_consent, status)
       VALUES ('password_reset','email',$1,$2,$3,'password_reset',1,'{}'::jsonb,false,'queued')`,
      [
        email,
        "Tautan reset kata sandi",
        `Buka ${env.appUrl}/reset-password?token=${token} untuk membuat kata sandi baru.\nTautan berlaku 1 jam dan hanya sekali pakai.`,
      ],
    );
    await writeAudit({
      actorKind: "guest",
      action: "auth.password_reset_requested",
      targetType: "user",
      targetId: userId,
      requestId: ctx.requestId,
      ipHash: ctx.ipHash,
    });
  }
  return {
    message:
      "Jika email tersebut terdaftar, tautan pemulihan sudah dikirim. Periksa kotak masuk dan folder spam.",
  };
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ message: string }> {
  parseOrThrow(passwordSchema, newPassword);
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT id, user_id, expires_at, consumed_at FROM auth_tokens WHERE token_hash = $1 AND purpose = 'reset_password' LIMIT 1`,
    [await hashOpaque(token)],
  );
  const row = res.rows[0];
  if (!row)
    throw new AppError("VALIDATION_FAILED", "Tautan reset tidak dikenali.", { status: 400 });
  if (row.consumed_at)
    throw new AppError("VALIDATION_FAILED", "Tautan reset sudah dipakai. Ajukan ulang.", {
      status: 410,
    });
  const expiresAt = date(row.expires_at);
  if (expiresAt && expiresAt.getTime() < Date.now())
    throw new AppError("VALIDATION_FAILED", "Tautan reset kedaluwarsa. Ajukan ulang.", {
      status: 410,
    });

  const storedHash = hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE users SET password_hash = $2, password_algo = 'scrypt', failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
      [text(row.user_id), storedHash],
    );
    await tx.query(`UPDATE auth_tokens SET consumed_at = now() WHERE id = $1`, [text(row.id)]);
    await tx.query(
      `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [text(row.user_id)],
    );
    await tx.query(
      `UPDATE auth_tokens SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`,
      [text(row.user_id)],
    );
  });
  await writeAudit({
    actorId: text(row.user_id),
    actorKind: "system",
    action: "auth.password_reset",
    targetType: "user",
    targetId: text(row.user_id),
    afterData: { sessionsRevoked: true },
  });
  return { message: "Kata sandi baru disimpan. Silakan masuk kembali." };
}

export async function changePassword(
  ctx: RequestContext,
  currentPassword: string,
  newPassword: string,
): Promise<{ message: string }> {
  if (!ctx.user) throw new AppError("UNAUTHENTICATED", "Masuk terlebih dahulu.", { status: 401 });
  parseOrThrow(passwordSchema, newPassword);
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT password_hash FROM users WHERE id = $1`,
    [ctx.user.id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Akun tidak ditemukan.", { status: 404 });
  if (!verifyPassword(currentPassword, String(row.password_hash))) {
    throw new AppError("UNAUTHENTICATED", "Kata sandi saat ini tidak cocok.", {
      status: 401,
      details: { reason: "invalid_credentials" },
    });
  }
  await db.query(
    `UPDATE users SET password_hash = $2, password_algo = 'scrypt', updated_at = now() WHERE id = $1`,
    [ctx.user.id, hashPassword(newPassword)],
  );
  await writeAudit({
    actorId: ctx.user.id,
    actorEmail: ctx.user.email,
    actorKind: "customer",
    action: "auth.password_changed",
    targetType: "user",
    targetId: ctx.user.id,
    requestId: ctx.requestId,
  });
  return { message: "Kata sandi diperbarui. Perangkat lain akan diminta masuk ulang." };
}

export async function beginMfaEnrollment(
  ctx: RequestContext,
): Promise<{ secret: string; provisioningUri: string; instructions: string }> {
  if (!ctx.user) throw new AppError("UNAUTHENTICATED", "Masuk terlebih dahulu.", { status: 401 });
  const db = await getDb();
  const secret = generateTotpSecret();
  await db.query(`UPDATE users SET mfa_secret_enc = $2 WHERE id = $1`, [
    ctx.user.id,
    await encryptSecret(secret),
  ]);
  return {
    secret,
    provisioningUri: totpProvisioningUri(secret, ctx.user.email, env.appName),
    instructions:
      "Simpan kode di aplikasi authenticator, lalu konfirmasi satu kode 6 angka untuk mengaktifkan MFA. Aktifkan hanya bila aplikasi sudah siap.",
  };
}

export async function confirmMfaEnrollment(
  ctx: RequestContext,
  code: string,
): Promise<{ message: string }> {
  if (!ctx.user) throw new AppError("UNAUTHENTICATED", "Masuk terlebih dahulu.", { status: 401 });
  const db = await getDb();
  const res = await db.query<{ mfa_secret_enc: unknown }>(
    `SELECT mfa_secret_enc FROM users WHERE id = $1`,
    [ctx.user.id],
  );
  const enc = res.rows[0]?.mfa_secret_enc;
  if (!enc)
    throw new AppError(
      "VALIDATION_FAILED",
      "Belum ada proses pengaturan MFA. Mulai ulang dari halaman keamanan.",
      { status: 422 },
    );
  const secret = await decryptSecret(String(enc));
  if (!verifyTotp(secret, code.trim(), { window: 1 })) {
    throw new AppError("UNAUTHENTICATED", "Kode tidak cocok. Pastikan waktu perangkat tepat.", {
      status: 401,
      details: { reason: "mfa_invalid" },
    });
  }
  await db.query(`UPDATE users SET mfa_enabled_at = now(), updated_at = now() WHERE id = $1`, [
    ctx.user.id,
  ]);
  await writeAudit({
    actorId: ctx.user.id,
    actorEmail: ctx.user.email,
    actorKind: "customer",
    action: "auth.mfa_enabled",
    targetType: "user",
    targetId: ctx.user.id,
    requestId: ctx.requestId,
  });
  return { message: "MFA aktif. Simpan nomor akun Anda di tempat aman." };
}

export async function disableMfa(
  ctx: RequestContext,
  password: string,
): Promise<{ message: string }> {
  if (!ctx.user) throw new AppError("UNAUTHENTICATED", "Masuk terlebih dahulu.", { status: 401 });
  const db = await getDb();
  const res = await db.query<{ password_hash: unknown }>(
    `SELECT password_hash FROM users WHERE id = $1`,
    [ctx.user.id],
  );
  if (!res.rows[0] || !verifyPassword(password, String(res.rows[0].password_hash))) {
    throw new AppError("UNAUTHENTICATED", "Kata sandi tidak cocok.", {
      status: 401,
      details: { reason: "invalid_credentials" },
    });
  }
  await db.query(
    `UPDATE users SET mfa_secret_enc = NULL, mfa_enabled_at = NULL, updated_at = now() WHERE id = $1`,
    [ctx.user.id],
  );
  await writeAudit({
    actorId: ctx.user.id,
    actorEmail: ctx.user.email,
    actorKind: "customer",
    action: "auth.mfa_disabled",
    targetType: "user",
    targetId: ctx.user.id,
    reason: "diminta pengguna",
    requestId: ctx.requestId,
  });
  return { message: "MFA dinonaktifkan untuk akun ini." };
}

export async function listSessions(ctx: RequestContext): Promise<
  Array<{
    publicId: string;
    createdAt: Date | null;
    expiresAt: Date | null;
    userAgent: string | null;
  }>
> {
  if (!ctx.user) throw new AppError("UNAUTHENTICATED", "Masuk terlebih dahulu.", { status: 401 });
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT public_id, created_at, expires_at, user_agent FROM sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 20`,
    [ctx.user.id],
  );
  return res.rows.map((r) => ({
    publicId: text(r.public_id),
    createdAt: date(r.created_at),
    expiresAt: date(r.expires_at),
    userAgent: r.user_agent ? String(r.user_agent) : null,
  }));
}

export async function revokeOtherSessions(
  ctx: RequestContext,
): Promise<{ message: string; revoked: number }> {
  if (!ctx.user) throw new AppError("UNAUTHENTICATED", "Masuk terlebih dahulu.", { status: 401 });
  const db = await getDb();
  const res = await db.query<{ id: string }>(
    `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`,
    [ctx.user.id],
  );
  await writeAudit({
    actorId: ctx.user.id,
    actorKind: "customer",
    action: "auth.sessions_revoked",
    targetType: "user",
    targetId: ctx.user.id,
    requestId: ctx.requestId,
  });
  return { message: "Semua sesi aktif dicabut. Masuk ulang diperlukan.", revoked: res.rows.length };
}

/** Peran yang boleh dipasang untuk akun staf / pelanggan (validasi RBAC dua arah). */
export function rolesAllowedForKind(
  kind: "customer" | "staff",
): Array<{ code: Role; label: string; restriction: string | null }> {
  return ROLES.filter((role) => (kind === "staff" ? role !== "customer" : role === "customer")).map(
    (code) => ({
      code,
      label: ROLE_LABELS[code],
      restriction: ROLE_RESTRICTIONS[code] ?? null,
    }),
  );
}
