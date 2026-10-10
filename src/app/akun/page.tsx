import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomerPage } from "@/server/context";
import { getProfile } from "@/server/services/account.service";
import { listCustomerOrders } from "@/server/services/order.service";
import { listCustomerReturns } from "@/server/services/return.service";
import { RETURN_STATUS_LABELS } from "@/domain/returns";
import { formatDate, formatIDR } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/state";
import { ButtonLink } from "@/components/ui/button";

/**
 * Ringkasan akun (desain §13 "Akun saya"). Halaman ini sengaja ada sebagai titik masuk:
 * tautan navigasi, email transaksi, dan hasil redirect semuanya menunjuk ke /akun, jadi
 * ia harus menampilkan ringkasan - bukan 404.
 */

export const metadata: Metadata = {
  title: "Akun saya",
  robots: { index: false, follow: false },
};

const QUICK_LINKS = [
  {
    href: "/akun/pesanan",
    label: "Pesanan saya",
    description: "Status,Invoice, dan lacak kiriman.",
  },
  {
    href: "/akun/retur",
    label: "Retur & refund",
    description: "Ajukan retur dan pantau keputusan.",
  },
  {
    href: "/akun/alamat",
    label: "Buku alamat",
    description: "Alamat pengiriman untuk checkout berikutnya.",
  },
  {
    href: "/akun/wishlist",
    label: "Wishlist",
    description: "Produk yang kamu simpan untuk nanti.",
  },
  {
    href: "/akun/privasi",
    label: "Privasi",
    description: "Salin data atau minta penghapusan (UU PDP).",
  },
];

export default async function AccountOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ pesan?: string; err?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requireCustomerPage("/akun");
  const [profile, orders, returns] = await Promise.all([
    getProfile(ctx),
    listCustomerOrders(ctx, { page: 1 }),
    listCustomerReturns(ctx),
  ]);
  const openReturns = returns.filter((row) =>
    ["requested", "awaiting_return", "item_received", "inspected"].includes(row.status),
  );
  const needsAttention = !profile.emailVerified;

  return (
    <div className="flex flex-col gap-5">
      {params.pesan ? <Alert tone="success">{params.pesan}</Alert> : null}
      {params.err ? <Alert tone="danger">{params.err}</Alert> : null}
      {needsAttention ? (
        <Alert tone="warning" title="Email belum diverifikasi">
          <p>
            Verifikasi email untuk memulihkan kata sandi dan menerima notifikasi transaksi.{" "}
            <Link className="font-semibold underline" href="/verifikasi-email">
              Verifikasi sekarang
            </Link>
          </p>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <StatCard label="Total pesanan" value={String(profile.orderCount)} href="/akun/pesanan" />
        <StatCard label="Retur berjalan" value={String(openReturns.length)} href="/akun/retur" />
        <StatCard
          label="Alamat tersimpan"
          value={String(profile.addressCount)}
          href="/akun/alamat"
        />
      </div>

      <Card>
        <CardHeader
          title="Pesanan terakhir"
          subtitle={
            orders.total > 0
              ? `${orders.total} pesanan dalam riwayat kamu`
              : "Belum ada pesanan pada akun ini"
          }
          action={
            orders.total > 0 ? (
              <ButtonLink href="/akun/pesanan" variant="secondary" size="sm">
                Lihat semua
              </ButtonLink>
            ) : undefined
          }
        />
        {orders.rows.length === 0 ? (
          <EmptyState
            title="Belum ada pesanan"
            description="Setelah kamu checkout, status pembayaran, pengiriman, dan retur akan muncul di sini."
            action={<ButtonLink href="/cari">Mulai belanja</ButtonLink>}
            icon="🧺"
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {orders.rows.slice(0, 3).map((order) => (
              <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/pesanan/${order.orderNumber}`}
                    className="text-[15px] font-semibold hover:underline"
                  >
                    {order.orderNumber}
                  </Link>
                  <p className="mt-0.5 text-[13px] text-secondary">
                    {formatDate(order.createdAt)} · {order.itemCount} baris ·{" "}
                    {formatIDR(order.totalAmount)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip status={order.status} label={order.statusLabel} />
                  <StatusChip
                    kind="payment"
                    status={order.paymentStatus}
                    label={order.paymentStatusLabel}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {openReturns.length > 0 ? (
        <Card>
          <CardHeader title="Retur yang perlu diperhatikan" />
          <ul className="flex flex-col divide-y divide-border">
            {openReturns.slice(0, 3).map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link href={`/retur/${row.reference}`} className="font-semibold hover:underline">
                    {row.reference}
                  </Link>
                  <p className="mt-0.5 text-[13px] text-secondary">
                    Untuk pesanan {row.orderNumber} · diajukan {formatIDR(row.requestedAmount)}
                  </p>
                </div>
                <StatusChip
                  kind="return"
                  status={row.status}
                  label={RETURN_STATUS_LABELS[row.status] ?? row.status}
                />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Kelola bagian lain" />
        <ul className="grid gap-3 sm:grid-cols-2">
          {QUICK_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="flex min-h-[44px] flex-col justify-center rounded-card border border-border bg-surface px-4 py-3 hover:border-brand focus-visible:border-brand"
              >
                <span className="text-[15px] font-semibold">{link.label}</span>
                <span className="text-[13px] text-secondary">{link.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-[13px] text-secondary">
        Anggota sejak {profile.memberSince ? formatDate(profile.memberSince) : "—"} · zona waktu{" "}
        {profile.timezone}
      </p>
    </div>
  );
}

function StatCard({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link
      href={href}
      className="card card-pad flex items-end justify-between gap-3 hover:border-brand focus-visible:border-brand"
    >
      <span className="text-[13px] text-secondary">{label}</span>
      <span className="text-[26px] leading-[32px] font-semibold">{value}</span>
    </Link>
  );
}
