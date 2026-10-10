import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { getRequestContext } from "@/server/context";
import { ROLE_LABELS, adminNavForPermissions } from "@/domain/rbac";
import { logoutAction } from "@/app/actions/auth";

const LABELS: Record<string, string> = {
  "/admin": "Ringkasan",
  "/admin/katalog": "Katalog",
  "/admin/inventaris": "Inventaris",
  "/admin/pesanan": "Pesanan",
  "/admin/retur": "Retur",
  "/admin/promosi": "Promosi",
  "/admin/pelanggan": "Pelanggan",
  "/admin/pengguna": "Pengguna & role",
  "/admin/audit": "Audit log",
  "/admin/pengaturan": "Pengaturan",
};

/**
 * Gerbang admin center: staf saja (default-deny). Navigasi dibangun dari permission, jadi
 * menu tidak pernah menampilkan area yang tidak bisa diakses pengguna.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await getRequestContext();
  if (!ctx.user) redirect("/masuk?setelah=/admin");
  if (!ctx.isStaff) redirect("/akun/pesanan?pesan=Akun+pelanggan+tidak+punya+akses+admin.");

  const items = adminNavForPermissions(ctx.permissions).map((href) => ({
    href,
    label: LABELS[href] ?? href.replace("/admin/", ""),
  }));

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="page flex min-h-[56px] flex-wrap items-center gap-3 py-2">
          <Link href="/admin" className="text-[15px] font-extrabold tracking-tight">
            {BRAND.name} <span className="font-semibold text-brand">Admin</span>
          </Link>
          <span className="hidden rounded-pill border border-border px-2 py-0.5 text-[12px] text-secondary sm:inline">
            {ctx.user.roles.map((role) => ROLE_LABELS[role] ?? role).join(" · ") || "staf"}
          </span>
          <div className="ml-auto flex items-center gap-2 text-[13px]">
            <Link
              href="/"
              className="rounded-control border border-border px-3 py-1.5 font-semibold hover:bg-canvas"
            >
              Lihat toko
            </Link>
            <span className="hidden text-secondary sm:inline">{ctx.user.email}</span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="min-h-[36px] rounded-control border border-border px-3 font-semibold hover:bg-canvas"
              >
                Keluar
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="page flex flex-col gap-6 py-6 lg:flex-row">
        <aside className="lg:w-[248px] lg:shrink-0">
          <nav aria-label="Navigasi admin">
            <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5">
              {items.length === 0 ? (
                <li className="px-3 py-2 text-[13px] text-danger">
                  Akun ini belum punya izin area kerja apa pun.
                </li>
              ) : null}
              {items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="inline-flex min-h-[40px] w-full items-center whitespace-nowrap rounded-control px-3 text-[14px] font-semibold text-ink-soft hover:bg-surface hover:text-brand"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
