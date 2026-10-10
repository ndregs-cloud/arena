import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCustomerPage } from "@/server/context";
import { getCustomerOrder, listCustomerPayments } from "@/server/services/order.service";
import { ORDER_STATUS_LABELS } from "@/domain/orders";
import { addMinutes } from "@/domain/clock";
import { env } from "@/platform/env";
import { formatDate, formatDateTime, formatIDR } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, TextArea } from "@/components/ui/field";
import { OrderLines } from "@/components/commerce/order-lines";
import { PayPanel } from "@/components/commerce/pay-panel";
import { cancelOrderAction, addNoteAction } from "@/app/actions/order";

export const metadata: Metadata = {
  title: "Detail pesanan",
  robots: { index: false, follow: false },
};

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ pesan?: string }>;
}) {
  const [{ orderNumber }, query] = await Promise.all([params, searchParams]);
  const ctx = await requireCustomerPage("/pesanan/[orderNumber]");
  if (!ctx.user) redirect(`/masuk?setelah=${encodeURIComponent(`/pesanan/${orderNumber}`)}`);
  const detail = await getCustomerOrder(ctx, orderNumber).catch(() => null);
  if (!detail) notFound();
  const payments = await listCustomerPayments(ctx, detail.id);
  const canCancel = detail.allowedActions.some((action) => action.to === "cancelled");
  const canReturn = ["delivered", "completed"].includes(detail.status);
  const deadline = detail.createdAt
    ? addMinutes(new Date(detail.createdAt), env.paymentTimeoutMinutes)
    : null;
  const paid = detail.paymentStatus === "succeeded";

  return (
    <div className="page section">
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-secondary">
        <Link href="/akun/pesanan" className="hover:underline">
          Pesanan saya
        </Link>
        <span aria-hidden="true"> › </span>
        <span className="text-ink-soft">{detail.orderNumber}</span>
      </nav>

      {query.pesan ? (
        <Alert tone="info" className="mb-4">
          {query.pesan}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] leading-[32px] md:text-[32px] md:leading-[40px]">
            Pesanan {detail.orderNumber}
          </h1>
          <p className="mt-1 text-[14px] text-secondary">
            Dibuat {formatDateTime(detail.createdAt)} · {detail.lines.length} item
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusChip
            status={detail.status}
            label={ORDER_STATUS_LABELS[detail.status] ?? detail.status}
          />
          <StatusChip
            kind="payment"
            status={detail.paymentStatus}
            label={detail.paymentStatus.replace(/_/g, " ")}
          />
          <StatusChip
            kind="shipment"
            status={detail.fulfillmentStatus}
            label={detail.fulfillmentStatus.replace(/_/g, " ")}
          />
        </div>
      </div>

      {!paid && detail.status === "pending_payment" ? (
        <Alert tone="warning" className="mt-4" title="Menunggu pembayaran">
          Pesanan belum dibayar.{" "}
          {deadline
            ? `Batas bayar ${formatDateTime(deadline)}; setelah itu stok dilepas kembali.`
            : ""}
        </Alert>
      ) : null}
      {detail.status === "cancelled" ? (
        <Alert tone="danger" className="mt-4" title="Pesanan dibatalkan">
          {detail.cancelReason ?? "Tanpa alasan tercatat."}
        </Alert>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Isi pesanan" />
            <OrderLines lines={detail.lines} />
            <dl className="mt-4 flex flex-col gap-2 border-t border-border pt-3 text-[14px]">
              <div className="flex justify-between gap-3">
                <dt className="text-secondary">Subtotal</dt>
                <dd className="tnum font-semibold">{formatIDR(detail.subtotalAmount)}</dd>
              </div>
              {detail.discountAmount > 0 ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-secondary">Diskon</dt>
                  <dd className="tnum font-semibold text-success">
                    −{formatIDR(detail.discountAmount)}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <dt className="text-secondary">Ongkir</dt>
                <dd className="tnum font-semibold">
                  {detail.shippingAmount === 0 ? "Gratis" : formatIDR(detail.shippingAmount)}
                </dd>
              </div>
              {detail.feeAmount > 0 ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-secondary">Biaya layanan</dt>
                  <dd className="tnum font-semibold">{formatIDR(detail.feeAmount)}</dd>
                </div>
              ) : null}
              {detail.refundedAmount > 0 ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-secondary">Refund selesai</dt>
                  <dd className="tnum font-semibold text-danger">
                    −{formatIDR(detail.refundedAmount)}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3 border-t border-border pt-2">
                <dt className="font-semibold">Total dibayar</dt>
                <dd className="tnum text-[18px] font-bold">{formatIDR(detail.totalAmount)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Paket & pelacakan"
              action={
                <Link
                  href={`/lacak-pesanan/${detail.trackingToken}`}
                  className="link text-[13px] font-semibold"
                >
                  Tautan lacak publik →
                </Link>
              }
            />
            {detail.shipments.length === 0 ? (
              <p className="text-[14px] text-secondary">Paket belum diserahkan ke kurir.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {detail.shipments.map((shipment) => (
                  <li key={shipment.id} className="rounded-card border border-border p-3">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                      {shipment.carrierCode} / {shipment.serviceCode}
                      <StatusChip
                        kind="shipment"
                        status={shipment.status}
                        label={shipment.statusLabel}
                      />
                      {shipment.isTrackingManual ? (
                        <Badge tone="neutral">catatan manual</Badge>
                      ) : null}
                    </p>
                    <p className="tnum mt-1 text-[13px] text-ink-soft">
                      Resi {shipment.trackingNumber ?? "-"} · {shipment.packageCount} paket
                      {shipment.deliveredAt
                        ? ` · diterima ${formatDate(shipment.deliveredAt)}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Riwayat status" />
            <ol className="flex flex-col gap-3">
              {detail.timeline
                .filter((entry) => entry.visibility === "customer")
                .slice(0, 12)
                .map((entry) => (
                  <li key={entry.id} className="border-l-2 border-border pl-3">
                    <p className="text-[14px] font-semibold text-ink">
                      {entry.note ?? entry.eventType}
                    </p>
                    <p className="text-[12px] text-secondary">
                      {entry.createdAt ? formatDateTime(entry.createdAt) : ""}
                      {entry.fromStatus && entry.toStatus
                        ? ` · ${entry.fromStatus} → ${entry.toStatus}`
                        : ""}
                    </p>
                  </li>
                ))}
            </ol>
          </Card>

          {detail.returns.length > 0 ? (
            <Card>
              <CardHeader title="Retur pada pesanan ini" />
              <ul className="flex flex-col gap-2">
                {detail.returns.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-[14px]"
                  >
                    <span className="flex items-center gap-2">
                      <Link className="link font-semibold" href={`/retur/${item.reference}`}>
                        {item.reference}
                      </Link>
                      <StatusChip
                        kind="return"
                        status={item.status}
                        label={item.status.replace(/_/g, " ")}
                      />
                    </span>
                    <span className="tnum text-ink-soft">{formatIDR(item.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          {!paid && detail.status === "pending_payment" ? (
            <Card>
              <CardHeader
                title="Bayar pesanan"
                subtitle="Instruksi diterbitkan oleh penyedia (adapter simulasi di lingkungan ini)."
              />
              <PayPanel
                orderNumber={detail.orderNumber}
                token={detail.trackingToken}
                scenarioAllowed={env.isEmbeddedDatabase && process.env.NODE_ENV !== "production"}
              />
            </Card>
          ) : null}

          {payments.length > 0 ? (
            <Card>
              <CardHeader
                title="Percobaan pembayaran"
                subtitle="Status hanya berubah dari konfirmasi provider."
              />
              <ul className="flex flex-col gap-2 text-[14px]">
                {payments.map((attempt) => (
                  <li
                    key={attempt.id}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span>
                      <span className="font-semibold">{attempt.method}</span>
                      <span className="block text-[12px] text-secondary">
                        {formatDateTime(attempt.createdAt)}
                        {attempt.providerRef ? ` · ref ${attempt.providerRef}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusChip kind="payment" status={attempt.status} label={attempt.status} />
                      <span className="tnum">{attempt.amountLabel}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Alamat pengiriman" />
            <address className="text-[14px] not-italic leading-[21px] text-ink-soft">
              <strong className="text-ink">{detail.shippingAddress.fullName}</strong>
              <br />
              {detail.shippingAddress.street}
              {detail.shippingAddress.landmark ? `, ${detail.shippingAddress.landmark}` : ""}
              <br />
              {detail.shippingAddress.district}, {detail.shippingAddress.city}
              <br />
              {detail.shippingAddress.province} {detail.shippingAddress.postalCode}
              <br />
              {detail.shippingAddress.phone}
            </address>
          </Card>

          {canReturn ? (
            <Card>
              <CardHeader
                title="Retur"
                subtitle="Ajukan sebelum 14 hari setelah barang diterima."
              />
              <Link
                href={`/pesanan/${detail.orderNumber}/retur`}
                className="min-h-[44px] inline-flex w-full items-center justify-center rounded-control border border-border px-4 text-[14px] font-semibold hover:bg-canvas"
              >
                Ajukan retur / refund
              </Link>
            </Card>
          ) : null}

          {canCancel ? (
            <Card>
              <CardHeader
                title="Batalkan pesanan"
                subtitle={
                  detail.allowedActions.find((action) => action.to === "cancelled")?.description
                }
              />
              <form action={cancelOrderAction} className="flex flex-col gap-3">
                <input type="hidden" name="orderId" value={detail.id} />
                <input type="hidden" name="orderNumber" value={detail.orderNumber} />
                <Field label="Alasan pembatalan" htmlFor="cancel-reason" required>
                  <TextArea
                    id="cancel-reason"
                    name="reason"
                    required
                    rows={3}
                    placeholder="Mis. salah ukuran, butuh lebih cepat, berubah pikiran."
                  />
                </Field>
                <Button type="submit" variant="danger" size="sm">
                  Batalkan pesanan
                </Button>
              </form>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Catatan untuk penjual"
              subtitle="Tersimpan di riwayat pesanan; tim layanan dapat membacanya."
            />
            <form action={addNoteAction} className="flex flex-col gap-3">
              <input type="hidden" name="orderId" value={detail.id} />
              <input type="hidden" name="orderNumber" value={detail.orderNumber} />
              <Field label="Catatan" htmlFor="note" required>
                <TextArea
                  id="note"
                  name="note"
                  required
                  rows={3}
                  placeholder="Mis. titip di satpam bila tidak ada orang."
                />
              </Field>
              <Button type="submit" variant="secondary" size="sm">
                Simpan catatan
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
