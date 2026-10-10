import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SHIPMENT_STATUSES, SHIPMENT_STATUS_LABELS } from "@/domain/shipping";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/domain/orders";
import { hasPermission, requireStaffPage } from "@/server/context";
import { adminGetOrder, adminListOrders } from "@/server/services/order.service";
import { env } from "@/platform/env";
import { formatDateTime, formatIDR } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { StatusChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, SelectInput, TextArea, TextInput, CheckboxRow } from "@/components/ui/field";
import { Table, Td, Tr } from "@/components/ui/table";
import { OrderLines } from "@/components/commerce/order-lines";
import {
  addOrderNoteAction,
  addTrackingEventAction,
  approveRefundAction,
  createShipmentAction,
  requestRefundAction,
  transitionOrderAction,
} from "@/app/actions/admin";

export const metadata: Metadata = {
  title: "Admin - detail pesanan",
  robots: { index: false, follow: false },
};

export default async function AdminOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ no: string }>;
  searchParams: Promise<{ pesan?: string; err?: string }>;
}) {
  const [{ no }, query] = await Promise.all([params, searchParams]);
  const ctx = await requireStaffPage("/admin/pesanan");
  const list = await adminListOrders(ctx, { q: no, perPage: 1 });
  const summary = list.rows[0];
  if (!summary) notFound();
  const order = await adminGetOrder(ctx, summary.id);
  const canProcess = hasPermission(ctx, "order.process");
  const canCancel = hasPermission(ctx, "order.cancel");
  const canShip = hasPermission(ctx, "shipment.manage");
  const canTrack = hasPermission(ctx, "tracking.manage");
  const canRefund = hasPermission(ctx, "order.refund");
  const refundable = Math.max(0, order.totalAmount - order.refundedAmount);

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-[13px] text-secondary">
        <Link href="/admin/pesanan" className="hover:underline">
          Pesanan
        </Link>
        <span aria-hidden="true"> › </span>
        <span className="text-ink-soft">{order.orderNumber}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] leading-[32px]">{order.orderNumber}</h1>
          <p className="mt-1 text-[13px] text-secondary">
            {order.email} · {order.phone} · dibuat {formatDateTime(order.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusChip
            status={order.status}
            label={ORDER_STATUS_LABELS[order.status] ?? order.status}
          />
          <StatusChip
            kind="payment"
            status={order.paymentStatus}
            label={order.paymentStatus.replace(/_/g, " ")}
          />
          <StatusChip
            kind="shipment"
            status={order.fulfillmentStatus}
            label={order.fulfillmentStatus.replace(/_/g, " ")}
          />
        </div>
      </div>

      {query.pesan ? <Alert tone="success">{query.pesan}</Alert> : null}
      {query.err ? <Alert tone="danger">{query.err}</Alert> : null}
      {!env.isEmbeddedDatabase ? null : (
        <Alert tone="warning" title="Basis data tertanam (pglite)">
          Status pembayaran & pengirman dijalankan lewat adapter simulasi; jangan pakai sebagai
          bukti transaksi nyata.
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Isi pesanan"
              action={
                <span className="tnum text-[16px] font-bold">{formatIDR(order.totalAmount)}</span>
              }
            />
            <OrderLines lines={order.lines} />
            <dl className="mt-4 grid gap-2 border-t border-border pt-3 text-[14px] sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-secondary">Subtotal</dt>
                <dd className="tnum">{formatIDR(order.subtotalAmount)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-secondary">Diskon</dt>
                <dd className="tnum text-success">−{formatIDR(order.discountAmount)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-secondary">Ongkir</dt>
                <dd className="tnum">{formatIDR(order.shippingAmount)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-secondary">Sudah direfund</dt>
                <dd className="tnum">{formatIDR(order.refundedAmount)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-secondary">Sisa refundable</dt>
                <dd className="tnum font-semibold">{formatIDR(refundable)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-secondary">Kebijakan disetujui</dt>
                <dd className="tnum">{order.policyVersion}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Paket"
              action={
                order.shipments.length > 0 ? (
                  <Link
                    href={`/lacak-pesanan/${order.trackingToken}`}
                    className="link text-[13px] font-semibold"
                  >
                    Tampilan pelanggan →
                  </Link>
                ) : null
              }
            />
            {order.shipments.length === 0 ? (
              <p className="text-[14px] text-secondary">
                Belum ada paket tercatat untuk order ini.
              </p>
            ) : (
              <ul className="flex flex-col gap-4">
                {order.shipments.map((shipment) => (
                  <li key={shipment.id} className="rounded-card border border-border p-3">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                      {shipment.carrierCode} / {shipment.serviceCode} · resi{" "}
                      {shipment.trackingNumber ?? "-"}
                      <StatusChip
                        kind="shipment"
                        status={shipment.status}
                        label={shipment.statusLabel}
                      />
                      {shipment.isTrackingManual ? (
                        <span className="text-[12px] text-warning">catatan manual</span>
                      ) : null}
                    </p>
                    <ol className="mt-2 flex flex-col gap-1 border-l-2 border-border pl-3 text-[13px]">
                      {shipment.events.map((event) => (
                        <li key={event.id}>
                          <span className="font-semibold text-ink">{event.label}</span>
                          <span className="text-secondary">
                            {" "}
                            · {event.occurredAt ? formatDateTime(event.occurredAt) : "-"}
                            {event.location ? ` · ${event.location}` : ""} · {event.source}
                          </span>
                        </li>
                      ))}
                    </ol>
                    {canTrack ? (
                      <form
                        action={addTrackingEventAction}
                        className="mt-3 flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="shipmentId" value={shipment.id} />
                        <input type="hidden" name="orderNumber" value={order.orderNumber} />
                        <Field label="Status" htmlFor={`trk-${shipment.id}`} className="w-[200px]">
                          <SelectInput
                            id={`trk-${shipment.id}`}
                            name="status"
                            defaultValue="in_transit"
                          >
                            {SHIPMENT_STATUSES.filter((status) => status !== "none").map(
                              (status) => (
                                <option key={status} value={status}>
                                  {SHIPMENT_STATUS_LABELS[status] ?? status}
                                </option>
                              ),
                            )}
                          </SelectInput>
                        </Field>
                        <Field
                          label="Lokasi"
                          htmlFor={`loc-${shipment.id}`}
                          className="min-w-[160px] flex-1"
                        >
                          <TextInput
                            id={`loc-${shipment.id}`}
                            name="location"
                            placeholder="Hub Jakarta"
                          />
                        </Field>
                        <Button size="sm" type="submit" variant="secondary">
                          Tambah event
                        </Button>
                      </form>
                    ) : (
                      <p className="hint mt-2">
                        Anda tidak punya izin tracking.manage untuk menambah event.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Riwayat"
              subtitle="Termasuk catatan internal; pelanggan hanya melihat baris bervisibilitas customer."
            />
            <ol className="flex flex-col gap-3">
              {order.timeline.slice(0, 24).map((entry) => (
                <li key={entry.id} className="border-l-2 border-border pl-3">
                  <p className="text-[14px] font-semibold text-ink">
                    {entry.note ?? entry.eventType}
                    {entry.visibility === "internal" ? (
                      <span className="ml-2 text-[11px] font-bold uppercase text-warning">
                        internal
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[12px] text-secondary">
                    {entry.actorKind} · {entry.createdAt ? formatDateTime(entry.createdAt) : "-"}
                    {entry.fromStatus && entry.toStatus
                      ? ` · ${entry.fromStatus} → ${entry.toStatus}`
                      : ""}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {canProcess || canCancel ? (
            <Card>
              <CardHeader
                title="Ubah status"
                subtitle="Transisi dijaga domain: lompat status dan pengiriman tanpa pembayaran akan ditolak."
              />
              <form action={transitionOrderAction} className="flex flex-col gap-3">
                <input type="hidden" name="orderId" value={order.id} />
                <input type="hidden" name="orderNumber" value={order.orderNumber} />
                <input type="hidden" name="backTo" value={`/admin/pesanan/${order.orderNumber}`} />
                <Field label="Status tujuan" htmlFor="to" required>
                  <SelectInput
                    id="to"
                    name="to"
                    defaultValue={order.allowedActions[0]?.to ?? "processing"}
                  >
                    {order.allowedActions.map((action) => (
                      <option key={action.to} value={action.to}>
                        {action.label} - {action.description}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="Alasan / catatan" htmlFor="reason">
                  <TextArea
                    id="reason"
                    name="reason"
                    rows={2}
                    placeholder="Mis. barang diambil kurir pukul 15.00"
                  />
                </Field>
                <Button type="submit" size="sm" disabled={order.allowedActions.length === 0}>
                  Simpan transisi
                </Button>
                {order.allowedActions.length === 0 ? (
                  <p className="hint">Tidak ada transisi yang sah dari status ini.</p>
                ) : null}
              </form>
              {canCancel && order.status !== "cancelled" ? (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="hint mb-2">
                    {canRefund
                      ? "Pembatalan setelah dibayar otomatis membuka ledger refund (menunggu persetujuan bila di atas ambang)."
                      : "Tanpa izin order.refund, permintaan refund diantrekan ke keuangan."}
                  </p>
                </div>
              ) : null}
            </Card>
          ) : null}

          {canShip ? (
            <Card>
              <CardHeader
                title="Catat pengiriman"
                subtitle="Carrier & resi dicatat manual; label kurir nyata dibuat oleh provider."
              />
              <form action={createShipmentAction} className="flex flex-col gap-3">
                <input type="hidden" name="orderId" value={order.id} />
                <input type="hidden" name="orderNumber" value={order.orderNumber} />
                <Field label="Kode kurir" htmlFor="carrierCode" required>
                  <TextInput id="carrierCode" name="carrierCode" defaultValue="simulasi" required />
                </Field>
                <Field label="Layanan" htmlFor="serviceCode" required>
                  <TextInput id="serviceCode" name="serviceCode" defaultValue="reg" required />
                </Field>
                <Field
                  label="Nomor resi"
                  htmlFor="trackingNumber"
                  required
                  hint="Minimal 6 karakter."
                >
                  <TextInput
                    id="trackingNumber"
                    name="trackingNumber"
                    required
                    placeholder="SIM-RESI-000123"
                  />
                </Field>
                <Field label="Jumlah paket" htmlFor="packageCount">
                  <TextInput
                    id="packageCount"
                    name="packageCount"
                    type="number"
                    min={1}
                    defaultValue={1}
                  />
                </Field>
                <CheckboxRow
                  id="markShipped"
                  name="markShipped"
                  label="Langsung tandai diserahkan ke kurir"
                  hint="Mengubah status order ke 'shipped' bila pembayaran sudah lunas."
                />
                <Button type="submit" size="sm">
                  Simpan paket
                </Button>
              </form>
            </Card>
          ) : null}

          {canRefund ? (
            <Card>
              <CardHeader
                title="Refund"
                subtitle={`Sisa yang dapat dikembalikan ${formatIDR(refundable)}. Di atas ${formatIDR(env.refundAutoApproveLimit)} butuh penyetuju berbeda.`}
              />
              {refundable === 0 ? (
                <p className="text-[14px] text-secondary">
                  Tidak ada nominal yang bisa direfund lagi.
                </p>
              ) : (
                <form action={requestRefundAction} className="flex flex-col gap-3">
                  <input type="hidden" name="orderId" value={order.id} />
                  <input type="hidden" name="orderNumber" value={order.orderNumber} />
                  <Field label="Nominal (Rupiah utuh)" htmlFor="amount" required>
                    <TextInput
                      id="amount"
                      name="amount"
                      type="number"
                      min={1}
                      max={refundable}
                      defaultValue={refundable}
                      required
                    />
                  </Field>
                  <Field label="Alasan" htmlFor="refund-reason" required>
                    <TextArea
                      id="refund-reason"
                      name="reason"
                      rows={2}
                      required
                      placeholder="Mis. barang dibatalkan sebelum dikirim"
                    />
                  </Field>
                  <CheckboxRow
                    id="includeShipping"
                    name="includeShipping"
                    label="Sertakan ongkir"
                    hint="Hanya untuk kesalahan di sisi toko."
                  />
                  <Button type="submit" size="sm" variant="danger">
                    Ajukan refund
                  </Button>
                </form>
              )}

              {order.refunds.length > 0 ? (
                <ul className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
                  {order.refunds.map((refund) => (
                    <li key={refund.id} className="text-[13px]">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="tnum font-semibold text-ink">{refund.reference}</span>
                        <StatusChip kind="payment" status={refund.status} label={refund.status} />
                      </span>
                      <span className="block text-secondary">
                        {formatIDR(refund.amount)} · {refund.reason}
                        {refund.includeShipping ? " · termasuk ongkir" : ""}
                        {refund.providerRef ? ` · ref ${refund.providerRef}` : ""}
                      </span>
                      {refund.status === "requested" ? (
                        <form
                          action={approveRefundAction}
                          className="mt-1 flex flex-wrap items-center gap-2"
                        >
                          <input type="hidden" name="refundId" value={refund.id} />
                          <input type="hidden" name="note" value="Disetujui dari halaman admin." />
                          <input
                            type="hidden"
                            name="backTo"
                            value={`/admin/pesanan/${order.orderNumber}`}
                          />
                          <Button size="sm" type="submit" variant="success">
                            Setujui & proses
                          </Button>
                          <button
                            type="submit"
                            name="decision"
                            value="rejected"
                            className="min-h-[36px] rounded-control border border-border px-3 text-[13px] font-semibold text-danger hover:bg-danger-soft"
                          >
                            Tolak
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Pembayaran" subtitle="Hanya berubah dari konfirmasi provider." />
            {order.payments.length === 0 ? (
              <p className="text-[14px] text-secondary">Belum ada attempt pembayaran.</p>
            ) : (
              <Table head={["Metode", "Status", "Nominal"]}>
                {order.payments.map((attempt) => (
                  <Tr key={attempt.id}>
                    <Td label="Metode">
                      {attempt.method}
                      <span className="block text-[12px] text-secondary">
                        {attempt.providerRef ?? "-"}
                      </span>
                    </Td>
                    <Td label="Status">
                      <StatusChip kind="payment" status={attempt.status} label={attempt.status} />
                    </Td>
                    <Td label="Nominal" className="tnum">
                      {attempt.amountLabel}
                    </Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Alamat & catatan" />
            <address className="text-[14px] not-italic leading-[21px] text-ink-soft">
              <strong className="text-ink">{order.shippingAddress.fullName}</strong> (
              {order.shippingAddress.phone})
              <br />
              {order.shippingAddress.street}
              {order.shippingAddress.landmark ? `, ${order.shippingAddress.landmark}` : ""}
              <br />
              {order.shippingAddress.district}, {order.shippingAddress.city},{" "}
              {order.shippingAddress.province} {order.shippingAddress.postalCode}
            </address>
            <p className="hint mt-2">
              Tautan lacak publik:{" "}
              <code className="rounded-tile bg-canvas px-1">
                /lacak-pesanan/{order.trackingToken.slice(0, 10)}…
              </code>
            </p>
            <form action={addOrderNoteAction} className="mt-3 flex flex-col gap-2">
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="orderNumber" value={order.orderNumber} />
              <Field label="Catatan internal" htmlFor="note">
                <TextArea id="note" name="note" rows={2} placeholder="Tidak terlihat pelanggan." />
              </Field>
              <Button size="sm" variant="secondary" type="submit">
                Simpan catatan
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
