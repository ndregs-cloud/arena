import { permissionsForRole, type Permission, type Role } from "@/domain/rbac";
import { getDb, text } from "@/platform/db";
import { hashPassword } from "@/platform/password";
import type { RequestContext } from "@/server/context";
import type { SessionUser } from "@/platform/auth";

/** Konteks uji: service hanya boleh mempercayai ctx, bukan cookie, jadi ctx dibuat manual. */
export function makeUser(overrides: Partial<SessionUser> & { id: string }): SessionUser {
  return {
    email: `${overrides.id.slice(0, 8)}@example.test`,
    fullName: "Pengguna Uji",
    phone: "081200000000",
    kind: "customer",
    roles: ["customer"],
    permissions: [],
    mfaEnabled: false,
    requiresMfa: false,
    ...overrides,
  };
}

export function makeCtx(
  input: {
    user?: SessionUser | null;
    permissions?: Permission[];
    cartToken?: string;
    role?: Role;
  } = {},
): RequestContext {
  const role = input.role ?? "system_admin";
  const permissions = new Set<Permission>(
    input.permissions ?? (input.user ? [] : [...permissionsForRole(role)]),
  );
  return {
    requestId: `test-${Math.random().toString(36).slice(2, 10)}`,
    user: input.user ?? null,
    permissions,
    cartToken: input.cartToken ?? `test-cart-${Math.random().toString(36).slice(2, 10)}`,
    ipHash: "test-ip",
    userAgent: "vitest",
    isStaff: input.user?.kind === "staff" || (!input.user && role !== "customer"),
    canPreviewCatalog: input.user?.kind === "staff" || permissions.has("catalog.view_draft"),
  };
}

export function staffCtx(role: Role, id = "00000000-0000-4000-8000-000000000001"): RequestContext {
  return makeCtx({
    user: makeUser({
      id,
      kind: "staff",
      roles: [role],
      permissions: [...permissionsForRole(role)],
      fullName: `Staf ${role}`,
    }),
    permissions: [...permissionsForRole(role)],
  });
}

/**
 * ctx pelanggan dengan AKUN NYATA (baris `users` + role customer). `carts.user_id` ber-FK ke users,
 * jadi id karangan akan gagal di DB - helper ini membuat akun sekali lalu memakainya ulang.
 * Label yang sama = akun yang sama (untuk menguji kepemilikan/IDOR), label beda = akun beda.
 */
export async function customerCtx(label: string): Promise<RequestContext> {
  const user = await ensureCustomer(label);
  return makeCtx({
    user,
    permissions: [...permissionsForRole("customer")],
    cartToken: `test-cart-${label}`,
  });
}

export function guestCtx(cartToken: string): RequestContext {
  return makeCtx({ user: null, permissions: [], cartToken });
}

/**
 * Akun pelanggan nyata (tabel `users` + role `customer`) untuk uji integrasi.
 * `carts.user_id` punya FK ke users, jadi ctx pelanggan harus memakai id yang benar-benar ada.
 */
export async function ensureCustomer(label: string): Promise<SessionUser> {
  const db = await getDb();
  const email = `pelanggan-${label}@ndre.gstore.test`;
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE email_normalized = $1`,
    [email.toLowerCase()],
  );
  let id = existing.rows[0]?.id;
  if (!id) {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, password_algo, full_name, phone, kind, is_active, email_verified_at)
       VALUES ($1,$2,'scrypt',$3,$4,'customer',true,now()) RETURNING id`,
      [email, hashPassword(`KataSandiUji-2026`), `Pelanggan ${label}`, "081200000000"],
    );
    id = String(inserted.rows[0]?.id);
    await db.query(
      `INSERT INTO user_roles (user_id, role_code) VALUES ($1,'customer') ON CONFLICT DO NOTHING`,
      [id],
    );
  }
  return {
    id: String(id),
    email,
    fullName: `Pelanggan ${label}`,
    phone: "081200000000",
    kind: "customer",
    roles: ["customer"],
    permissions: [...permissionsForRole("customer")],
    mfaEnabled: false,
    requiresMfa: false,
  };
}

const STAFF_EMAIL_BY_ROLE: Partial<Record<Role, string>> = {
  system_admin: "admin@ndre.gstore.test",
  catalog_editor: "katalog@ndre.gstore.test",
  order_operator: "operator@ndre.gstore.test",
  customer_support: "cs@ndre.gstore.test",
  warehouse_operator: "gudang@ndre.gstore.test",
  finance: "keuangan@ndre.gstore.test",
  manager: "manager@ndre.gstore.test",
  auditor: "audit@ndre.gstore.test",
};

/**
 * ctx staf dengan AKUN NYATA dari seed (id dari tabel users).
 * Penting: `refunds.requested_by`, `audit_logs.actor_id`, dsb. ber-FK ke users - id karangan akan
 * gagal di DB dan menutupi kegagalan yang sebenarnya ingin diuji.
 */
export async function staffCtxForRole(role: Role): Promise<RequestContext> {
  const email = STAFF_EMAIL_BY_ROLE[role] ?? "admin@ndre.gstore.test";
  const db = await getDb();
  const res = await db.query<{ id: string; full_name: string }>(
    `SELECT id, full_name FROM users WHERE email_normalized = $1`,
    [email.toLowerCase()],
  );
  const row = res.rows[0];
  if (!row) throw new Error(`akun staf ${email} tidak ditemukan - jalankan node scripts/seed.mjs`);
  const permissions = [...permissionsForRole(role)];
  return makeCtx({
    user: makeUser({
      id: String(row.id),
      email,
      fullName: text(row.full_name),
      kind: "staff",
      roles: [role],
      permissions,
    }),
    permissions,
  });
}
