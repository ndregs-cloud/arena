import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomerPage } from "@/server/context";
import { listCustomerOrders } from "@/server/services/order.service";
import { formatDateTime, formatIDR } from "@/lib/format";
import { StatusChip } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/state";
import { ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Pesanan saya",
  robots: { index: false, follow: false },
};

const FILTERS = [
  { value: "", label: "Semua" },
  { value: "pending_payment", label: "Menunggu bayar" },
  { value: "processing", label: "Diproses" },
  { value: "shipped", label: "Dikirim" },
  { value: "delivered", label: "Terkirim" },
  { value: "cancelled", label: "Dibatalkan" },
];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; pesan?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requireCustomerPage("/akun/pesanan");
  const status = typeof params.status === "string" ? params.status : "";
  const page = Number(params.page ?? 1) || 1;
  const { rows, total } = await listCustomerOrders(ctx, { status: status || undefined, page });

  return (
    <div className="flex flex-col gap-4">
      {params.pesan ? <Alert tone="info">{params.pesan}</Alert> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-1">
          {FILTERS.map((filter) => {
            const active = filter.value === status;
            return (
              <li key={filter.label}>
                <Link
                  href={filter.value ? `/akun/pesanan?status=${filter.value}` : "/akun/pesanan"}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-[36px] items-center rounded-pill border px-3 text-[13px] font-semibold",
                    active
                      ? "border-brand bg-brand text-white"
                      : "border-border bg-surface text-ink-soft hover:border-brand hover:text-brand",
                  )}
                >
                  {filter.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="hint">{total} pesanan</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Belum ada pesanan di sini"
          description="Pesanan yang Anda buat akan muncul di daftar ini lengkap dengan status pembayaran dan paket."
          action={<ButtonLink href="/cari">Mulai belanja</ButtonLink>}
          icon="◇"
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((order) => (
            <li key={order.id}>
              <article className="card card-pad flex flex-wrap items-center gap-4">
                <div className="min-w-[180px] flex-1">
                  <p className="tnum text-[15px] font-bold text-ink">{order.orderNumber}</p>
                  <p className="text-[13px] text-secondary">
                    {order.itemCount} item ·{" "}
                    {order.createdAt ? formatDateTime(order.createdAt) : "-"}
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
                <p className="tnum min-w-[120px] text-right text-[16px] font-bold">
                  {formatIDR(order.totalAmount)}
                </p>
                <div className="flex flex-wrap gap-2">
                  <ButtonLink size="sm" variant="secondary" href={`/pesanan/${order.orderNumber}`}>
                    Detail
                  </ButtonLink>
                  <ButtonLink
                    size="sm"
                    variant="ghost"
                    href={`/lacak-pesanan/${order.trackingToken}`}
                  >
                    Lacak
                  </ButtonLink>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
