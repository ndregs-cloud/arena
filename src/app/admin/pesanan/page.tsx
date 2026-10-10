import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/context";
import { adminListOrders } from "@/server/services/order.service";
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/domain/orders";
import { formatDateTime, formatIDR } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { StatusChip } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { Table, Td, Tr } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = {
  title: "Admin - pesanan",
  robots: { index: false, follow: false },
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    payment?: string;
    page?: string;
    pesan?: string;
    err?: string;
  }>;
}) {
  const query = await searchParams;
  const ctx = await requireStaffPage("/admin/pesanan");
  const page = Number(query.page ?? 1) || 1;
  const result = await adminListOrders(ctx, {
    q: query.q,
    status: query.status,
    paymentStatus: query.payment,
    page,
    perPage: 25,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[24px] leading-[32px]">Pesanan</h1>
        <p className="mt-1 text-[13px] text-secondary">
          {result.total} pesanan cocok dengan filter ini.
        </p>
      </div>
      {query.pesan ? <Alert tone="success">{query.pesan}</Alert> : null}
      {query.err ? <Alert tone="danger">{query.err}</Alert> : null}

      <Card>
        <CardHeader title="Cari & saring" subtitle="Nomor pesanan, email, atau ponsel pelanggan." />
        <form method="get" action="/admin/pesanan" className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[240px] flex-1 flex-col gap-1">
            <span className="label">Kata kunci</span>
            <input
              name="q"
              defaultValue={query.q ?? ""}
              className="control"
              placeholder="NS-2026… / pelanggan@…"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Status</span>
            <select
              name="status"
              defaultValue={query.status ?? ""}
              className="control min-w-[180px]"
            >
              <option value="">Semua status</option>
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {ORDER_STATUS_LABELS[status] ?? status}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Pembayaran</span>
            <select
              name="payment"
              defaultValue={query.payment ?? ""}
              className="control min-w-[160px]"
            >
              <option value="">Semua</option>
              <option value="awaiting_payment">Menunggu</option>
              <option value="succeeded">Lunas</option>
              <option value="partially_refunded">Refund sebagian</option>
              <option value="refunded">Refund penuh</option>
              <option value="failed">Gagal</option>
            </select>
          </label>
          <button
            type="submit"
            className="min-h-[44px] rounded-control bg-brand px-4 text-[15px] font-semibold text-white hover:bg-brand-hover"
          >
            Terapkan
          </button>
        </form>
      </Card>

      {result.rows.length === 0 ? (
        <EmptyState
          title="Tidak ada pesanan"
          description="Ubah filter, atau buat pesanan uji lewat storefront."
          icon="◇"
        />
      ) : (
        <Table head={["Pesanan", "Pelanggan", "Status", "Pembayaran", "Total", "Dibuat"]}>
          {result.rows.map((order) => (
            <Tr key={order.id}>
              <Td label="Pesanan">
                <Link className="link font-semibold" href={`/admin/pesanan/${order.orderNumber}`}>
                  {order.orderNumber}
                </Link>
                <span className="block text-[12px] text-secondary">{order.itemCount} item</span>
              </Td>
              <Td label="Pelanggan">
                <span className="block">{order.customerLabel}</span>
                <span className="block text-[12px] text-secondary">
                  {order.email} · {order.city}
                </span>
              </Td>
              <Td label="Status">
                <StatusChip status={order.status} label={order.statusLabel} />
              </Td>
              <Td label="Pembayaran">
                <StatusChip
                  kind="payment"
                  status={order.paymentStatus}
                  label={order.paymentStatusLabel}
                />
              </Td>
              <Td label="Total" className="tnum font-semibold">
                {formatIDR(order.totalAmount)}
              </Td>
              <Td label="Dibuat" className="text-[13px]">
                {order.createdAt ? formatDateTime(order.createdAt) : "-"}
              </Td>
            </Tr>
          ))}
        </Table>
      )}

      <Pagination
        page={result.page}
        perPage={result.perPage}
        total={result.total}
        base="/admin/pesanan"
        searchParams={{ q: query.q, status: query.status, payment: query.payment }}
      />
    </div>
  );
}
