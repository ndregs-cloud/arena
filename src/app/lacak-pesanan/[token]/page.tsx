import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderByTrackingToken } from "@/server/services/order.service";
import { ORDER_STATUS_LABELS } from "@/domain/orders";
import { SHIPMENT_STATUS_LABELS } from "@/domain/shipping";
import { formatDateTime, formatIDR } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/state";
import { OrderLines } from "@/components/commerce/order-lines";

export const metadata: Metadata = {
  title: "Lacak pesanan",
  robots: { index: false, follow: false },
  description: "Lacak status paket tanpa masuk akun. Tautan lacak hanya menampilkan data minimal.",
};

/** Lacak publik via token (Blueprint §6.4): tanpa akun, tanpa membocorkan alamat penuh. */
export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await getOrderByTrackingToken(token);
  if (!result) notFound();
  const { order, timeline, shipments, maskedEmail, maskedPhone } = result;

  return (
    <div className="page section">
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-secondary">
        <Link href="/" className="hover:underline">
          Beranda
        </Link>
        <span aria-hidden="true"> › </span>
        <span className="text-ink-soft">Lacak pesanan</span>
      </nav>
      <h1 className="text-[24px] leading-[32px]">Pesanan {order.orderNumber}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-[14px] text-secondary">
        <StatusChip
          status={order.status}
          label={ORDER_STATUS_LABELS[order.status] ?? order.status}
        />
        <span>
          {maskedEmail} · {maskedPhone}
        </span>
      </p>
      <Alert tone="info" className="mt-4" title="Kontak paket">
        Alamat lengkap tidak ditampilkan di halaman publik. Hubungi dukungan bila kurir membutuhkan
        detail tambahan.
      </Alert>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Paket"
              subtitle={
                shipments.length > 0 ? `${shipments.length} paket dicatat` : "Belum ada paket"
              }
            />
            {shipments.length === 0 ? (
              <EmptyState
                title="Paket belum dibuat"
                description="Status akan muncul setelah penjual menyerahkan barang ke kurir."
                icon="◇"
              />
            ) : (
              <ul className="flex flex-col gap-4">
                {shipments.map((shipment) => (
                  <li key={shipment.id}>
                    <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                      {shipment.carrierCode} / {shipment.serviceCode}
                      <StatusChip
                        kind="shipment"
                        status={shipment.status}
                        label={
                          shipment.statusLabel ??
                          SHIPMENT_STATUS_LABELS[shipment.status] ??
                          shipment.status
                        }
                      />
                    </p>
                    <p className="tnum mt-1 text-[14px] text-ink-soft">
                      Resi <strong>{shipment.trackingNumber ?? "-"}</strong> ·{" "}
                      {shipment.packageCount} paket
                    </p>
                    <ol className="mt-3 flex flex-col gap-2 border-l-2 border-border pl-4">
                      {shipment.events.map((event) => (
                        <li key={event.id} className="relative text-[14px]">
                          <span
                            aria-hidden="true"
                            className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-brand"
                          />
                          <span className="font-semibold text-ink">{event.label}</span>
                          <span className="block text-[12px] text-secondary">
                            {event.occurredAt ? formatDateTime(event.occurredAt) : "-"}
                            {event.location ? ` · ${event.location}` : ""}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Isi pesanan" subtitle={`Total ${formatIDR(order.totalAmount)}`} />
            <OrderLines lines={order.lines} />
          </Card>
        </div>

        <Card>
          <CardHeader title="Riwayat" />
          <ol className="flex flex-col gap-3">
            {timeline
              .filter((entry) => entry.visibility === "customer")
              .map((entry) => (
                <li key={entry.id} className="text-[14px]">
                  <p className="font-semibold text-ink">{entry.note ?? entry.eventType}</p>
                  <p className="text-[12px] text-secondary">
                    {entry.createdAt ? formatDateTime(entry.createdAt) : ""}
                  </p>
                </li>
              ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
