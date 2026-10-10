import "server-only";
import { cookies, headers } from "next/headers";
import { sha256 } from "@/platform/crypto-helpers";
import { getDb } from "@/platform/db";
import { env } from "@/platform/env";
import { AppError } from "@/domain/errors";
import type { Permission, Role } from "@/domain/rbac";
import { PERMISSIONS } from "@/domain/rbac";

/**
 * Sesi & otorisasi sisi server (Blueprint §3.1, §5.4, §13.1).
 * Cookie: httpOnly + sameSite=lax + secure di produksi; tanda tangan HMAC; sesi dapat dicabut (revoked_at).
 * UI boleh SEMBUNYIKAN tombol, tetapi keputusan akhir selalu di service melalui requirePermission().
 */

export const SESSION_COOKIE = "nova_session";
export const CART_COOKIE = "nova_cart";
export const ALL_PERMISSIONS = PERMISSIONS;

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  kind: "customer" | "staff";
  roles: Role[];
  permissions: Permission[];
  mfaEnabled: boolean;
  requiresMfa: boolean;
}

export async function issueSessionCookie(sessionPublicId: string, userId: string): Promise<void> {
  const store = await cookies();
  const value = Buffer.from(
    JSON.stringify({ s: sessionPublicId, u: userId, t: Date.now() }),
    "utf8",
  ).toString("base64url");
  const mac = await sha256(`${env.authSecret}.${value}`);
  const maxAge = 3600 * (userId ? env.sessionTtlHours : env.sessionTtlHours);
  store.set(SESSION_COOKIE, `${value}.${mac}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export interface ParsedSession {
  sessionPublicId: string;
  userId: string;
}

/**
 * Sesi hanya berlaku kalau barisnya masih ada di DB, belum dicabut, dan belum kedaluwarsa.
 * Tanda tangan cookie saja tidak cukup: tanpanya "cabut semua sesi" (logout massal, reset kata
 * sandi, penyalahgunaan akun) baru terasa setelah TTL lewat - Blueprint §3.1 & §13.1.
 */
export async function isSessionLive(sessionPublicId: string, userId: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.query<{ ok: number }>(
    `SELECT 1 AS ok FROM sessions
      WHERE public_id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()
      LIMIT 1`,
    [sessionPublicId, userId],
  );
  if (res.rows.length === 0) return false;
  // "Terakhir terlihat" diperbarui maksimal sekali per menit supaya tidak menulis di tiap request.
  await db.query(
    `UPDATE sessions SET last_seen_at = now()
      WHERE public_id = $1 AND last_seen_at < now() - ($2 || ' seconds')::interval`,
    [sessionPublicId, "60"],
  );
  return true;
}

export async function readSessionCookie(): Promise<ParsedSession | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const [payload, mac] = raw.split(".");
  if (!payload || !mac) return null;
  const expected = await sha256(`${env.authSecret}.${payload}`);
  if (expected !== mac) return null; // tanda tangan tidak cocok -> anggap tidak ada sesi
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      s?: string;
      u?: string;
    };
    if (!parsed.s || !parsed.u) return null;
    if (!(await isSessionLive(parsed.s, parsed.u))) return null;
    return { sessionPublicId: parsed.s, userId: parsed.u };
  } catch {
    return null;
  }
}

/** Muat pengguna + peran + permission efektif dari DB (default deny bila tidak ada). */
export async function loadUser(userId: string): Promise<SessionUser | null> {
  const db = await getDb();
  const userRes = await db.query<Record<string, unknown>>(
    `SELECT id, email, full_name, phone, kind, mfa_secret_enc IS NOT NULL AND mfa_enabled_at IS NOT NULL AS mfa_enabled
       FROM users WHERE id = $1 AND is_active = true`,
    [userId],
  );
  const row = userRes.rows[0];
  if (!row) return null;
  const rolesRes = await db.query<{ role_code: string; is_privileged: boolean }>(
    `SELECT ur.role_code, r.is_privileged FROM user_roles ur JOIN roles r ON r.code = ur.role_code WHERE ur.user_id = $1`,
    [userId],
  );
  const permsRes = await db.query<{ permission_code: string }>(
    `SELECT DISTINCT rp.permission_code FROM user_roles ur JOIN role_permissions rp ON rp.role_code = ur.role_code WHERE ur.user_id = $1`,
    [userId],
  );
  const roles = rolesRes.rows.map((r) => r.role_code) as Role[];
  const permissions = permsRes.rows.map((r) => r.permission_code) as Permission[];
  const isStaff = String(row.kind ?? "customer") === "staff";
  return {
    id: String(row.id),
    email: String(row.email),
    fullName: String(row.full_name),
    phone: row.phone === null || row.phone === undefined ? null : String(row.phone),
    kind: isStaff ? "staff" : "customer",
    roles,
    permissions,
    mfaEnabled: Boolean(row.mfa_enabled),
    requiresMfa: isStaff && env.requireMfaForStaff,
  };
}

export async function revokeSession(sessionPublicId: string): Promise<void> {
  const db = await getDb();
  await db.query(
    "UPDATE sessions SET revoked_at = now() WHERE public_id = $1 AND revoked_at IS NULL",
    [sessionPublicId],
  );
}

/** Rate limit login sederhana berbasis DB (Blueprint §13.1 "rate limits" + anti-enumeration). */
export async function assertLoginNotThrottled(
  bucketKey: string,
  at: Date = new Date(),
): Promise<void> {
  const db = await getDb();
  const res = await db.query<{ attempts: unknown; window_started_at: unknown }>(
    "SELECT attempts, window_started_at FROM auth_attempts WHERE bucket = $1",
    [bucketKey],
  );
  const row = res.rows[0];
  if (!row) return;
  const windowStart = new Date(String(row.window_started_at));
  const inWindow = at.getTime() - windowStart.getTime() < env.authLockoutMinutes * 60_000;
  const attempts = Number(row.attempts);
  if (inWindow && attempts >= env.authMaxFailedAttempts) {
    throw new AppError(
      "RATE_LIMITED",
      "Terlalu banyak percobaan masuk. Coba lagi beberapa menit kemudian.",
      { status: 429 },
    );
  }
}

export async function recordFailedLogin(bucketKey: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO auth_attempts (bucket, attempts, window_started_at, last_attempt_at)
     VALUES ($1, 1, now(), now())
     ON CONFLICT (bucket) DO UPDATE
       SET attempts = CASE WHEN auth_attempts.window_started_at < now() - ($2 || ' minutes')::interval
                           THEN 1 ELSE auth_attempts.attempts + 1 END,
           window_started_at = CASE WHEN auth_attempts.window_started_at < now() - ($2 || ' minutes')::interval
                           THEN now() ELSE auth_attempts.window_started_at END,
           last_attempt_at = now()`,
    [bucketKey, String(env.authLockoutMinutes)],
  );
}

export async function clearFailedLogin(bucketKey: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE FROM auth_attempts WHERE bucket = $1", [bucketKey]);
}

export function loginBucket(email: string, ipHash: string | null): string {
  return `${sha256Sync(email.toLowerCase())}:${ipHash ?? "unknown"}`;
}

function sha256Sync(value: string): string {
  // Stabil & cepat untuk kunci rate-limit; bukan rahasia.
  let h1 = 0xdeadbeef ^ value.length;
  let h2 = 0x41c6ce57 ^ value.length;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

export function ipHashOf(ip: string | null): string | null {
  return ip ? sha256Sync(ip) : null;
}

/** Cookie cart tamu: token acak; server menyimpan cart, jadi harga tidak pernah dari klien. */
export async function readCartToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(CART_COOKIE)?.value ?? null;
}

export async function writeCartToken(token: string): Promise<void> {
  const store = await cookies();
  store.set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** Origin check untuk mutating API route (CSRF). */
export async function assertTrustedOrigin(allowedOrigins: string[] = []): Promise<void> {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return; // request non-browser / curl tanpa Origin dibiarkan (sudah dilindungi cookie SameSite)
  const host = h.get("host");
  const allowed = new Set(
    [`http://${host}`, `https://${host}`, env.appUrl, ...allowedOrigins].filter(Boolean),
  );
  if (!allowed.has(origin.replace(/\/$/, ""))) {
    throw new AppError(
      "CSRF_ORIGIN_REJECTED",
      "Asal permintaan tidak dikenal. Muat ulang halaman lalu coba lagi.",
      { status: 403 },
    );
  }
}
