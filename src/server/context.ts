import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "@/domain/errors";
import { can, type Permission } from "@/domain/rbac";
import {
  ipHashOf,
  loadUser,
  readCartToken,
  readSessionCookie,
  writeCartToken,
  type SessionUser,
} from "@/platform/auth";
import { generateCartToken } from "@/domain/ids";
import { getDb } from "@/platform/db";

/**
 * Konteks request: siapa aktornya, permission efektif, request ID untuk korelasi, dan cart token.
 * Semua service menerima konteks ini; tidak ada service yang membaca cookie sendiri.
 */

export interface RequestContext {
  requestId: string;
  user: SessionUser | null;
  permissions: Set<Permission>;
  /** token cart tamu (dibuat otomatis bila belum ada) */
  cartToken: string;
  ipHash: string | null;
  userAgent: string | null;
  isStaff: boolean;
  canPreviewCatalog: boolean;
}

function isCookieWriteNotAllowed(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Cookies can only be modified");
}

export async function getRequestContext(
  options: { createCartToken?: boolean } = {},
): Promise<RequestContext> {
  const h = await headers();
  const requestId = h.get("x-request-id") ?? globalThis.crypto.randomUUID();
  const session = await readSessionCookie();
  const user = session ? await loadUser(session.userId) : null;
  let cartToken = await readCartToken();
  if (!cartToken && options.createCartToken !== false) {
    cartToken = generateCartToken();
    // Penulisan cookie hanya sah di Server Action / Route Handler. Saat halaman (GET) dirender,
    // Next menolak Mutating cookies - karena itu penulisannya dicoba dan bila ditolak, token
    // tetap dipakai sebatas request ini. Keranjang tamu baru benar-benar dibuat lewat aksi
    // (addToCart/checkout), dan di sanalah cookie di-set, jadi tidak ada state yang hilang.
    try {
      await writeCartToken(cartToken);
    } catch (error) {
      if (!isCookieWriteNotAllowed(error)) throw error;
    }
  }
  const permissions = new Set<Permission>(user?.permissions ?? []);
  return {
    requestId,
    user,
    permissions,
    cartToken: cartToken ?? "anonymous",
    ipHash: ipHashOf(h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null),
    userAgent: h.get("user-agent"),
    isStaff: user?.kind === "staff",
    canPreviewCatalog: user?.kind === "staff" ? true : can(permissions, "catalog.view_draft"),
  };
}

/**
 * Guard untuk halaman staf. Layout admin juga memeriksa, TAPI Next merender layout dan page secara
 * paralel: tanpa guard ini halaman orang lain melempar PERMISSION_DENIED sebelum redirect layout
 * sempat dikirim. Mengembalikan konteks yang sudah dipastikan berisi sesi staf.
 */
export async function requireStaffPage(returnTo = "/admin"): Promise<RequestContext> {
  const ctx = await getRequestContext();
  if (!ctx.user) redirect(`/masuk?setelah=${encodeURIComponent(returnTo)}`);
  if (!ctx.isStaff) redirect("/akun/pesanan?pesan=Akun+pelanggan+tidak+punya+akses+admin.");
  return ctx;
}

/** Guard untuk halaman akun pelanggan (butuh sesi, bukan izin khusus). */
export async function requireCustomerPage(returnTo = "/akun/pesanan"): Promise<RequestContext> {
  const ctx = await getRequestContext();
  if (!ctx.user) redirect(`/masuk?setelah=${encodeURIComponent(returnTo)}`);
  return ctx;
}

export function requireUser(ctx: RequestContext): SessionUser {
  if (!ctx.user)
    throw new AppError("UNAUTHENTICATED", "Masuk terlebih dahulu untuk melanjutkan.", {
      status: 401,
    });
  return ctx.user;
}

/** Enforce otorisasi di server untuk setiap read/write (Blueprint §3.1). */
export function requirePermission(ctx: RequestContext, permission: Permission): void {
  if (!can(ctx.permissions, permission)) {
    throw new AppError("PERMISSION_DENIED", "Anda tidak memiliki akses untuk tindakan ini.", {
      status: 403,
      details: { permission },
    });
  }
}

export function requireAnyPermission(ctx: RequestContext, list: readonly Permission[]): void {
  if (list.length === 0) return;
  if (!list.some((p) => can(ctx.permissions, p))) {
    throw new AppError("PERMISSION_DENIED", "Anda tidak memiliki akses untuk area ini.", {
      status: 403,
      details: { anyOf: list },
    });
  }
}

export function hasPermission(ctx: RequestContext, permission: Permission): boolean {
  return can(ctx.permissions, permission);
}

/** Kepemilikan objek: pelanggan hanya boleh melihat ordernya sendiri (AT-07). */
export function assertOwnership(
  ctx: RequestContext,
  ownerId: string | null,
  resource = "Data ini",
): void {
  const user = requireUser(ctx);
  if (ownerId !== user.id) {
    throw new AppError("PERMISSION_DENIED", `${resource} tidak dapat diakses.`, { status: 403 });
  }
}

export async function healthCheck(): Promise<{
  ok: boolean;
  driver: string;
  products: number;
  detail: string;
}> {
  try {
    const db = await getDb();
    const res = await db.query<{ c: unknown }>("SELECT count(*)::int AS c FROM products");
    return {
      ok: true,
      driver: process.env.DATA_DRIVER ?? "pglite",
      products: Number(res.rows[0]?.c ?? 0),
      detail: "db reachable",
    };
  } catch (error) {
    return {
      ok: false,
      driver: process.env.DATA_DRIVER ?? "pglite",
      products: 0,
      detail: error instanceof Error ? error.message : "unknown",
    };
  }
}
