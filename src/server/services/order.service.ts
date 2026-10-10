import "server-only";
import { AppError } from "@/domain/errors";
import {
  assertCanCancelAutomatically,
  assertTransitionAllowed,
  allowedTransitions,
  FULFILLMENT_STATUS_LABELS,
  labelStatus,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type OrderSnapshot,
  type OrderStatus,
} from "@/domain/orders";
import {
  mapProviderTrackingState,
  SHIPMENT_STATUS_LABELS,
  shouldApplyTrackingEvent,
  type ShipmentStatus,
} from "@/domain/shipping";
import { writeAudit } from "@/platform/audit";
import { bool, date, getDb, jsonb, num, optNum, optText, text } from "@/platform/db";
import { enqueueNotification } from "@/platform/notifications";
import { formatIDR } from "@/lib/format";
import { maskEmail, maskPhone } from "@/domain/rbac";
import { requireAnyPermission, requirePermission, requireUser } from "@/server/context";
import { requestRefund } from "@/server/services/payment.service";
import { refundableAmount } from "@/domain/orders";
import type { RequestContext } from "@/server/context";
import {
  consumeReservationsForOrder,
  loadOrderSnapshot,
  releaseReservationsForOrder,
  releasePromotionForOrder,
} from "@/server/services/order-effects.service";

/** Order management (Blueprint §6.4, §7.2): transisi lewat command, timeline terpisah, audit. */

export interface OrderListItem {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  statusLabel: string;
  paymentStatus: string;
  paymentStatusLabel: string;
  fulfillmentStatus: string;
  fulfillmentStatusLabel: string;
  totalAmount: number;
  itemCount: number;
  createdAt: Date | null;
  paidAt: Date | null;
  customerLabel: string;
  trackingToken: string;
}

export interface OrderTimelineEntry {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorKind: string;
  note: string | null;
  createdAt: Date | null;
  visibility: "customer" | "internal";
}

export interface ShipmentRow {
  id: string;
  carrierCode: string;
  serviceCode: string;
  trackingNumber: string | null;
  status: ShipmentStatus;
  statusLabel: string;
  packageCount: number;
  labelRef: string | null;
  isTrackingManual: boolean;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  note: string | null;
  events: Array<{
    id: string;
    status: ShipmentStatus | null;
    label: string;
    location: string | null;
    occurredAt: Date | null;
    source: string;
  }>;
}

export async function listCustomerOrders(
  ctx: RequestContext,
  params: { status?: string; page?: number } = {},
): Promise<{ rows: OrderListItem[]; total: number }> {
  const user = requireUser(ctx);
  const db = await getDb();
  const page = Math.max(1, params.page ?? 1);
  const perPage = 10;
  const res = await db.query<Record<string, unknown>>(
    `SELECT o.*, COALESCE(items.item_count,0)::int AS item_count,
            (SELECT count(*)::int FROM orders o2 WHERE o2.customer_id = o.customer_id AND ($2::text IS NULL OR o2.status = $2)) AS total_count
       FROM orders o
       LEFT JOIN LATERAL (SELECT count(*)::int AS item_count, sum(quantity)::int AS qty FROM order_items oi WHERE oi.order_id = o.id) items ON true
      WHERE o.customer_id = $1 AND ($2::text IS NULL OR o.status = $2)
      ORDER BY o.created_at DESC
      LIMIT $3 OFFSET $4`,
    [user.id, params.status ?? null, perPage, (page - 1) * perPage],
  );
  const total = num(res.rows[0]?.total_count);
  return { rows: res.rows.map(mapOrderListItem), total };

  function mapOrderListItem(row: Record<string, unknown>): OrderListItem {
    return {
      id: text(row.id),
      orderNumber: text(row.order_number),
      status: text(row.status) as OrderStatus,
      statusLabel: labelStatus(text(row.status) as OrderStatus),
      paymentStatus: text(row.payment_status),
      paymentStatusLabel:
        PAYMENT_STATUS_LABELS[text(row.payment_status) as keyof typeof PAYMENT_STATUS_LABELS] ??
        text(row.payment_status),
      fulfillmentStatus: text(row.fulfillment_status),
      fulfillmentStatusLabel:
        FULFILLMENT_STATUS_LABELS[
          text(row.fulfillment_status) as keyof typeof FULFILLMENT_STATUS_LABELS
        ] ?? text(row.fulfillment_status),
      totalAmount: num(row.total_amount),
      itemCount: num(row.item_count),
      createdAt: date(row.created_at),
      paidAt: date(row.paid_at),
      customerLabel: text(row.order_number),
      trackingToken: text(row.tracking_token),
    };
  }
}

export interface CustomerOrderDetail extends OrderSnapshot {
  timeline: OrderTimelineEntry[];
  shipments: ShipmentRow[];
  allowedActions: Array<{ to: OrderStatus; label: string; description: string }>;
  returns: Array<{
    id: string;
    reference: string;
    status: string;
    amount: number;
    createdAt: Date | null;
  }>;
}

/** Order detail untuk pelanggan: hanya ordernya sendiri (AT-07). */
export async function getCustomerOrder(
  ctx: RequestContext,
  orderNumber: string,
): Promise<CustomerOrderDetail> {
  const user = requireUser(ctx);
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM orders WHERE order_number = $1 LIMIT 1`,
    [orderNumber],
  );
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Pesanan tidak ditemukan.", { status: 404 });
  if (optText(row.customer_id) !== user.id) {
    // Jangan bocorkan keberadaan order milik orang lain.
    throw new AppError("PERMISSION_DENIED", "Pesanan tidak ditemukan untuk akun Anda.", {
      status: 403,
    });
  }
  return buildOrderDetail(row, { includeInternalNotes: false });
}

/** Pelacakan tamu lewat token acak (Blueprint §5.4, desain §11.2). Data diminimalkan. */
export async function getOrderByTrackingToken(token: string): Promise<{
  order: OrderSnapshot;
  timeline: OrderTimelineEntry[];
  shipments: ShipmentRow[];
  maskedEmail: string;
  maskedPhone: string;
} | null> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM orders WHERE tracking_token = $1 LIMIT 1`,
    [token],
  );
  const row = res.rows[0];
  if (!row) return null;
  const detail = await buildOrderDetail(row, { includeInternalNotes: false });
  return {
    order: detail,
    timeline: detail.timeline,
    shipments: detail.shipments,
    maskedEmail: maskEmail(detail.email),
    maskedPhone: maskPhone(detail.phone),
  };
}

async function buildOrderDetail(
  row: Record<string, unknown>,
  options: { includeInternalNotes: boolean },
): Promise<CustomerOrderDetail> {
  const db = await getDb();
  const orderId = text(row.id);
  const [itemsRes, eventsRes, shipmentsRes, returnsRes] = await Promise.all([
    db.query<Record<string, unknown>>(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY id`, [
      orderId,
    ]),
    db.query<Record<string, unknown>>(
      `SELECT id, event_type, from_status, to_status, actor_kind, note, created_at, visibility, data
         FROM order_events WHERE order_id = $1 ${options.includeInternalNotes ? "" : "AND visibility = 'customer'"} ORDER BY id ASC`,
      [orderId],
    ),
    listShipments(orderId),
    db.query<Record<string, unknown>>(
      `SELECT id, reference, status, approved_amount, created_at FROM returns WHERE order_id = $1 ORDER BY created_at DESC`,
      [orderId],
    ),
  ]);

  const snapshot = await loadOrderSnapshot(orderId);
  if (!snapshot) throw new AppError("NOT_FOUND", "Pesanan tidak ditemukan.", { status: 404 });
  void itemsRes;

  const timeline: OrderTimelineEntry[] = eventsRes.rows.map((e) => ({
    id: text(e.id),
    eventType: text(e.event_type),
    fromStatus: optText(e.from_status),
    toStatus: optText(e.to_status),
    actorKind: text(e.actor_kind),
    note: optText(e.note),
    createdAt: date(e.created_at),
    visibility: text(e.visibility, "customer") as OrderTimelineEntry["visibility"],
  }));

  return {
    ...snapshot,
    timeline,
    shipments: shipmentsRes,
    allowedActions: allowedTransitions(snapshot.status).map((t) => ({
      to: t.to,
      label: transitionLabel(t.to),
      description: t.description,
    })),
    returns: returnsRes.rows.map((r) => ({
      id: text(r.id),
      reference: text(r.reference),
      status: text(r.status),
      amount: num(r.approved_amount),
      createdAt: date(r.created_at),
    })),
  };
}

function transitionLabel(to: OrderStatus): string {
  return ORDER_STATUS_LABELS[to] ?? to;
}

export async function listShipments(orderId: string): Promise<ShipmentRow[]> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT s.*, COALESCE(ev.events, '[]'::jsonb) AS events_json
       FROM shipments s
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status, 'label', t.status_label,
                                             'location', t.location, 'occurred_at', t.occurred_at, 'source', t.source)
                          ORDER BY t.occurred_at DESC) AS events
           FROM tracking_events t WHERE t.shipment_id = s.id
       ) ev ON true
      WHERE s.order_id = $1 ORDER BY s.created_at DESC`,
    [orderId],
  );
  return res.rows.map((row) => {
    const status = text(row.status, "created") as ShipmentStatus;
    const events = jsonb<Array<Record<string, unknown>>>(row.events_json, []).map((e) => ({
      id: text(e.id),
      status: mapProviderTrackingState(optText(e.status)) ?? (String(e.status) as ShipmentStatus),
      label: text(
        e.label,
        SHIPMENT_STATUS_LABELS[String(e.status) as ShipmentStatus] ?? String(e.status),
      ),
      location: optText(e.location),
      occurredAt: date(e.occurred_at),
      source: text(e.source, "manual"),
    }));
    return {
      id: text(row.id),
      carrierCode: text(row.carrier_code),
      serviceCode: text(row.service_code),
      trackingNumber: optText(row.tracking_number),
      status,
      statusLabel: SHIPMENT_STATUS_LABELS[status] ?? status,
      packageCount: num(row.package_count),
      labelRef: optText(row.label_ref),
      isTrackingManual: bool(row.is_tracking_manual),
      shippedAt: date(row.shipped_at),
      deliveredAt: date(row.delivered_at),
      note: optText(row.note),
      events,
    };
  });
}

// ---------------------------------------------------------------------
// Transisi status (command) - dipakai admin & job
// ---------------------------------------------------------------------

async function currentShipmentState(orderId: string): Promise<string | null> {
  const db = await getDb();
  const res = await db.query<{ status: string }>(
    `SELECT status FROM shipments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );
  return res.rows[0]?.status ?? null;
}

/**
 * Jalankan transisi status. Semua guard + efek samping terjadi dalam SATU transaksi,
 * dan permission aktor diperiksa sebelum menulis (Blueprint §6.4).
 */
export async function transitionOrder(
  ctx: RequestContext,
  orderId: string,
  to: OrderStatus,
  input: { reason?: string | null; note?: string | null } = {},
): Promise<{ order: OrderSnapshot; appliedEffects: string[] }> {
  requirePermission(ctx, to === "cancelled" ? "order.cancel" : "order.process");
  const db = await getDb();
  const orderRes = await db.query<Record<string, unknown>>(
    `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
    [orderId],
  );
  const row = orderRes.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Pesanan tidak ditemukan.", { status: 404 });
  const snapshot = await loadOrderSnapshot(orderId);
  if (!snapshot) throw new AppError("NOT_FOUND", "Pesanan tidak ditemukan.", { status: 404 });

  const shipmentState = await currentShipmentState(orderId);
  const reasonProvided = Boolean(input.reason && input.reason.trim().length > 0);
  const rule = assertTransitionAllowed(snapshot, to, { shipmentState, reasonProvided });

  const appliedEffects = await db.transaction(async (tx) => {
    const patch: string[] = ["status = $2", "updated_at = now()"];
    const params: unknown[] = [orderId, to];
    let idx = 3;
    const set = (clause: string, value?: unknown) => {
      if (value === undefined) params.push(null);
      else params.push(value);
      patch.push(`${clause} = $${idx++}`);
    };
    if (rule.effects.includes("set_paid_at")) set("paid_at", new Date().toISOString());
    if (rule.effects.includes("set_shipped_at")) set("shipped_at", new Date().toISOString());
    if (rule.effects.includes("set_delivered_at")) set("delivered_at", new Date().toISOString());
    if (rule.effects.includes("set_cancelled_at")) {
      set("cancelled_at", new Date().toISOString());
      set("cancel_reason", input.reason ?? null);
    }
    if (to === "processing") patch.push(`fulfillment_status = 'picking'`);
    if (to === "shipped") patch.push(`fulfillment_status = 'shipped'`);
    if (to === "delivered") patch.push(`fulfillment_status = 'delivered'`);
    if (to === "cancelled") patch.push(`fulfillment_status = 'cancelled'`);

    await tx.query(`UPDATE orders SET ${patch.join(", ")} WHERE id = $1`, params);

    await tx.query(
      `INSERT INTO order_events (order_id, event_type, from_status, to_status, actor_id, actor_kind, visibility, note, data, request_id)
       VALUES ($1,$2,$3,$4,$5,'staff','customer',$6,$7::jsonb,$8)`,
      [
        orderId,
        `status_${to}`,
        snapshot.status,
        to,
        ctx.user?.id ?? null,
        input.note ??
          `Perubahan status ke ${ORDER_STATUS_LABELS[to] ?? to} oleh ${ctx.user?.fullName ?? "sistem"}.`,
        JSON.stringify({ effects: rule.effects, reason: input.reason ?? null }),
        ctx.requestId,
      ],
    );

    if (input.reason && to !== "cancelled") {
      await tx.query(
        `INSERT INTO order_events (order_id, event_type, actor_kind, visibility, note, request_id)
         VALUES ($1,'internal_note','staff','internal',$2,$3)`,
        [orderId, input.reason, ctx.requestId],
      );
    }

    // Efek samping stok/keuangan
    if (rule.effects.includes("release_reservations")) {
      await releaseReservationsForOrder(orderId, "released", tx);
      await releasePromotionForOrder(orderId, tx);
    }
    if (rule.effects.includes("consume_reservations")) {
      // Aman dipanggil dua kali (paid dan shipped): hanya reservasi 'active' yang dikonsumsi.
      await consumeReservationsForOrder(orderId, tx);
    }
    if (rule.effects.includes("open_refund")) {
      // Placeholder: baris ledger refund dibuat SETELAH transaksi commit (lihat requestRefund di bawah).
      await tx.query(
        `INSERT INTO order_events (order_id, event_type, actor_kind, visibility, note, request_id)
         VALUES ($1,'refund_request_queued','system','internal',$2,$3)`,
        [
          orderId,
          "Pembatalan setelah pembayaran: permintaan refund dibuat di antrean keuangan dan harus diproses lewat ledger refund.",
          ctx.requestId,
        ],
      );
    }
    if (rule.effects.includes("prevent_new_returns")) {
      await tx.query(`UPDATE order_items SET is_returnable = false WHERE order_id = $1`, [orderId]);
    }
    if (rule.effects.includes("enqueue_fulfillment")) {
      await tx.query(
        `INSERT INTO integration_outbox (kind, destination, payload, idempotency_key)
         VALUES ('fulfilment.pick','warehouse',$1::jsonb,$2) ON CONFLICT DO NOTHING`,
        [
          JSON.stringify({
            orderId,
            orderNumber: snapshot.orderNumber,
            lines: snapshot.lines.map((l) => ({ sku: l.sku, quantity: l.quantity })),
          }),
          `pick:${orderId}`,
        ],
      );
    }
    if (rule.effects.includes("notify_customer")) {
      await tx.query(
        `INSERT INTO integration_outbox (kind, destination, payload, idempotency_key)
         VALUES ('order.notify','notification',$1::jsonb,$2) ON CONFLICT DO NOTHING`,
        [JSON.stringify({ orderId, to }), `notify:${orderId}:${to}`],
      );
    }
    return rule.effects;
  });

  if (appliedEffects.includes("open_refund") && to === "cancelled") {
    // Pembatalan setelah dibayar WAJIB lewat ledger refund; tidak pernah diberi label "uang sudah kembali"
    // tanpa konfirmasi penyedia. Bila aktor tidak berhak membuat refund, permintaan diantrekan untuk keuangan.
    try {
      await requestRefund(ctx, {
        orderId,
        amount: refundableAmount(snapshot),
        reason: input.reason ?? `Pembatalan ${snapshot.orderNumber} setelah pembayaran`,
        includeShipping: true,
      });
    } catch (error) {
      if (error instanceof AppError && error.code === "PERMISSION_DENIED") {
        await (
          await getDb()
        ).query(
          `INSERT INTO integration_outbox (kind, destination, payload, idempotency_key)
           VALUES ('refund.request','finance',$1::jsonb,$2) ON CONFLICT DO NOTHING`,
          [
            JSON.stringify({
              orderId,
              orderNumber: snapshot.orderNumber,
              reason: input.reason ?? null,
            }),
            `refund-request:${orderId}`,
          ],
        );
      } else {
        throw error;
      }
    }
  }

  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: `order.transition.${to}`,
    targetType: "order",
    targetId: orderId,
    beforeData: { status: snapshot.status },
    afterData: { status: to, effects: appliedEffects },
    reason: input.reason ?? undefined,
    requestId: ctx.requestId,
  });

  const updated = await loadOrderSnapshot(orderId);
  if (!updated)
    throw new AppError("INTERNAL_ERROR", "Gagal memuat ulang order setelah transisi.", {
      status: 500,
    });
  return { order: updated, appliedEffects };
}

export async function cancelOrder(
  ctx: RequestContext,
  orderId: string,
  reason: string,
): Promise<OrderSnapshot> {
  const snapshot = await loadOrderSnapshot(orderId);
  if (!snapshot) throw new AppError("NOT_FOUND", "Pesanan tidak ditemukan.", { status: 404 });
  assertCanCancelAutomatically(snapshot);
  if (!reason || reason.trim().length < 5) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Pembatalan wajib menyertakan alasan (minimal 5 karakter).",
      { status: 422 },
    );
  }
  const result = await transitionOrder(ctx, orderId, "cancelled", { reason: reason.trim() });
  await enqueueNotification({
    kind: "order_cancelled",
    to: snapshot.email,
    orderId,
    vars: { orderNumber: snapshot.orderNumber, reason: reason.trim() },
  });
  return result.order;
}

export async function addOrderNote(
  ctx: RequestContext,
  orderId: string,
  note: string,
  visibility: "internal" | "customer",
): Promise<void> {
  requireAnyPermission(ctx, ["order.view", "order.process"]);
  if (note.trim().length < 3)
    throw new AppError("VALIDATION_FAILED", "Catatan terlalu pendek.", { status: 422 });
  const db = await getDb();
  await db.query(
    `INSERT INTO order_events (order_id, event_type, actor_id, actor_kind, visibility, note, request_id)
     VALUES ($1,'note_added',$2,'staff',$3,$4,$5)`,
    [orderId, ctx.user?.id ?? null, visibility, note.trim(), ctx.requestId],
  );
}

// ---------------------------------------------------------------------
// Shipment & tracking (Blueprint §7.2)
// ---------------------------------------------------------------------

export interface CreateShipmentInput {
  carrierCode: string;
  serviceCode: string;
  trackingNumber: string;
  packageCount: number;
  note?: string;
  /** bila true, status order langsung diproses ke 'shipped' (butuh order.process) */
  markShipped?: boolean;
}

export async function createShipment(
  ctx: RequestContext,
  orderId: string,
  input: CreateShipmentInput,
): Promise<{ shipmentId: string; labelRef: string | null; message: string }> {
  requirePermission(ctx, "shipment.manage");
  const db = await getDb();
  const snapshot = await loadOrderSnapshot(orderId);
  if (!snapshot) throw new AppError("NOT_FOUND", "Pesanan tidak ditemukan.", { status: 404 });
  if (snapshot.paymentStatus !== "succeeded") {
    throw new AppError(
      "PAYMENT_NOT_CONFIRMED",
      "Pembayaran belum terkonfirmasi; pesanan tidak boleh diserahkan ke kurir.",
      { status: 422 },
    );
  }
  if (!["paid", "processing", "on_hold"].includes(snapshot.status)) {
    throw new AppError(
      "INVALID_STATE_TRANSITION",
      `Pesanan berstatus ${labelStatus(snapshot.status)} tidak dapat dibuatkan pengiriman.`,
      { status: 422 },
    );
  }
  const tracking = input.trackingNumber.trim();
  if (tracking.length < 6)
    throw new AppError("VALIDATION_FAILED", "Nomor resi minimal 6 karakter.", { status: 422 });

  const shipmentId = await db.transaction(async (tx) => {
    const res = await tx.query<{ id: string }>(
      `INSERT INTO shipments (order_id, carrier_code, service_code, tracking_number, status, package_count, label_ref, note, is_tracking_manual, created_by)
       VALUES ($1,$2,$3,$4,'created',$5,$6,$7,true,$8) RETURNING id`,
      [
        orderId,
        input.carrierCode,
        input.serviceCode,
        tracking,
        Math.max(1, input.packageCount),
        `MANUAL-${tracking.slice(-6)}`,
        input.note ?? null,
        ctx.user?.id ?? null,
      ],
    );
    const id = String(res.rows[0]?.id);
    for (const line of snapshot.lines) {
      await tx.query(
        `INSERT INTO shipment_items (shipment_id, order_item_id, quantity) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [id, line.orderItemId, line.quantity],
      );
    }
    await tx.query(
      `INSERT INTO tracking_events (shipment_id, status, status_label, location, occurred_at, source)
       VALUES ($1,'created',$2,$3,now(),'manual')`,
      [id, SHIPMENT_STATUS_LABELS.created, "Gudang"],
    );
    await tx.query(
      `INSERT INTO order_events (order_id, event_type, actor_id, actor_kind, visibility, note, request_id)
       VALUES ($1,'shipment_created',$2,'staff','customer',$3,$4)`,
      [
        orderId,
        ctx.user?.id ?? null,
        `Paket dicatat: ${input.carrierCode} / resi ${tracking} (${input.packageCount} paket).`,
        ctx.requestId,
      ],
    );
    return id;
  });

  let message = `Pengiriman dicatat untuk ${snapshot.orderNumber} (resi ${tracking}).`;
  if (input.markShipped) {
    try {
      await transitionOrder({ ...ctx }, orderId, "shipped", {
        reason: input.note ?? `Diserahkan ke ${input.carrierCode}`,
      });
      await enqueueNotification({
        kind: "order_shipped",
        to: snapshot.email,
        orderId,
        vars: {
          orderNumber: snapshot.orderNumber,
          carrier: input.carrierCode,
          trackingNumber: tracking,
          trackingUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/lacak-pesanan/${snapshot.trackingToken}`,
        },
      });
    } catch (error) {
      message += ` Catatan status gagal: ${error instanceof AppError ? error.message : "coba ubah status manual."}`;
    }
  }
  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: "shipment.create",
    targetType: "shipment",
    targetId: shipmentId,
    afterData: {
      orderId,
      carrierCode: input.carrierCode,
      trackingNumber: tracking,
      packageCount: input.packageCount,
    },
    requestId: ctx.requestId,
  });
  return { shipmentId, labelRef: `MANUAL-${tracking.slice(-6)}`, message };
}

export async function addTrackingEvent(
  ctx: RequestContext,
  shipmentId: string,
  input: {
    providerState?: string;
    status?: ShipmentStatus;
    location?: string;
    occurredAt?: string;
    note?: string;
  },
): Promise<{ applied: boolean; message: string; status: ShipmentStatus }> {
  requirePermission(ctx, "tracking.manage");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT s.*, s.order_id AS oid FROM shipments s WHERE s.id = $1`,
    [shipmentId],
  );
  const shipment = res.rows[0];
  if (!shipment) throw new AppError("NOT_FOUND", "Pengiriman tidak ditemukan.", { status: 404 });
  const current = text(shipment.status, "created") as ShipmentStatus;
  const incoming = (input.status ??
    mapProviderTrackingState(input.providerState)) as ShipmentStatus | null;
  if (!incoming)
    throw new AppError("VALIDATION_FAILED", "Status tracking tidak dikenali.", { status: 422 });

  const apply = shouldApplyTrackingEvent(current, incoming);
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  await db.query(
    `INSERT INTO tracking_events (shipment_id, status, status_label, location, occurred_at, source)
     VALUES ($1,$2,$3,$4,$5,'manual')`,
    [
      shipmentId,
      incoming,
      SHIPMENT_STATUS_LABELS[incoming] ?? incoming,
      input.location ?? null,
      occurredAt.toISOString(),
    ],
  );

  if (apply) {
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE shipments SET status=$2, updated_at=now(), shipped_at = CASE WHEN $2 <> 'created' AND shipped_at IS NULL THEN now() ELSE shipped_at END,
                             delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END WHERE id=$1`,
        [shipmentId, incoming],
      );
      await tx.query(
        `INSERT INTO order_events (order_id, event_type, actor_kind, visibility, note, request_id)
         VALUES ($1,'tracking_update','staff','customer',$2,$3)`,
        [
          text(shipment.oid),
          `Status paket: ${SHIPMENT_STATUS_LABELS[incoming] ?? incoming}${input.location ? ` (${input.location})` : ""}`,
          ctx.requestId,
        ],
      );
      if (incoming === "delivered") {
        await tx.query(
          `UPDATE orders SET fulfillment_status='delivered', delivered_at = COALESCE(delivered_at, now()), updated_at=now() WHERE id=$1 AND status='shipped'`,
          [text(shipment.oid)],
        );
      }
      if (incoming === "exception") {
        await tx.query(
          `UPDATE orders SET status='on_hold', updated_at=now() WHERE id=$1 AND status='shipped'`,
          [text(shipment.oid)],
        );
      }
    });
  }
  return {
    applied: apply,
    status: incoming,
    message: apply
      ? `Status paket diperbarui menjadi ${SHIPMENT_STATUS_LABELS[incoming] ?? incoming}.`
      : `Event diabaikan untuk status (tidak menurunkan status ${SHIPMENT_STATUS_LABELS[current] ?? current}); riwayat tetap tersimpan.`,
  };
}

/** Sinkronkan status order dari fakta tracking (dipakai setelah event 'delivered'). */
export async function syncOrderDeliveryFromShipment(
  ctx: RequestContext,
  orderId: string,
): Promise<void> {
  const db = await getDb();
  const res = await db.query<{ c: unknown }>(
    `SELECT count(*)::int AS c FROM shipments WHERE order_id=$1 AND status='delivered'`,
    [orderId],
  );
  if (num(res.rows[0]?.c) === 0) return;
  const order = await loadOrderSnapshot(orderId);
  if (!order || order.status !== "shipped") return;
  await transitionOrder(ctx, orderId, "delivered", {});
  const snapshot = await loadOrderSnapshot(orderId);
  if (snapshot) {
    await enqueueNotification({
      kind: "order_delivered",
      to: snapshot.email,
      orderId,
      vars: {
        orderNumber: snapshot.orderNumber,
        deliveredAt: new Date().toLocaleDateString("id-ID", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        returnDeadline: new Date(Date.now() + 14 * 86_400_000).toLocaleDateString("id-ID", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      },
    });
  }
}

// ---------------------------------------------------------------------
// Admin list/detail
// ---------------------------------------------------------------------

export interface AdminOrderFilters {
  q?: string;
  status?: string;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  from?: string;
  to?: string;
  page?: number;
  perPage?: number;
}

export async function adminListOrders(
  ctx: RequestContext,
  filters: AdminOrderFilters,
): Promise<{
  rows: Array<OrderListItem & { email: string; phone: string; city: string }>;
  total: number;
  page: number;
  perPage: number;
}> {
  requirePermission(ctx, "order.view");
  const db = await getDb();
  const page = Math.max(1, filters.page ?? 1);
  const perPage = Math.min(100, Math.max(10, filters.perPage ?? 20));
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (filters.q) {
    const p = push(`%${filters.q.toLowerCase()}%`);
    where.push(`(lower(o.order_number) LIKE ${p} OR lower(o.email) LIKE ${p} OR lower(o.phone) LIKE ${p}
                 OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND lower(oi.sku) LIKE ${p})
                 OR EXISTS (SELECT 1 FROM shipments sh WHERE sh.order_id = o.id AND lower(COALESCE(sh.tracking_number,'')) LIKE ${p}))`);
  }
  if (filters.status) where.push(`o.status = ${push(filters.status)}`);
  if (filters.paymentStatus) where.push(`o.payment_status = ${push(filters.paymentStatus)}`);
  if (filters.fulfillmentStatus)
    where.push(`o.fulfillment_status = ${push(filters.fulfillmentStatus)}`);
  if (filters.from)
    where.push(`o.created_at >= ${push(new Date(`${filters.from}T00:00:00`).toISOString())}`);
  if (filters.to)
    where.push(`o.created_at < ${push(new Date(`${filters.to}T23:59:59.999`).toISOString())}`);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countRes = await db.query<{ c: unknown }>(
    `SELECT count(*)::int AS c FROM orders o ${whereSql}`,
    params,
  );
  const res = await db.query<Record<string, unknown>>(
    `SELECT o.*, COALESCE(items.item_count,0)::int AS item_count, addr->>'city' AS city
       FROM orders o
       LEFT JOIN LATERAL (SELECT count(*)::int AS item_count FROM order_items oi WHERE oi.order_id = o.id) items ON true
       ${whereSql}
      ORDER BY o.created_at DESC
      LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
    params,
  );
  const canSeePii = requirePiiAccess(ctx);
  return {
    rows: res.rows.map((row) => ({
      ...mapRow(row),
      email: canSeePii ? text(row.email) : maskEmail(text(row.email)),
      phone: canSeePii ? text(row.phone) : maskPhone(text(row.phone)),
      city: text(
        jsonb<Record<string, unknown>>(row.shipping_address, {}).city ?? optText(row.city) ?? "",
      ),
    })),
    total: num(countRes.rows[0]?.c),
    page,
    perPage,
  };

  function mapRow(row: Record<string, unknown>): OrderListItem {
    return {
      id: text(row.id),
      orderNumber: text(row.order_number),
      status: text(row.status) as OrderStatus,
      statusLabel: ORDER_STATUS_LABELS[text(row.status) as OrderStatus] ?? text(row.status),
      paymentStatus: text(row.payment_status),
      paymentStatusLabel:
        PAYMENT_STATUS_LABELS[text(row.payment_status) as keyof typeof PAYMENT_STATUS_LABELS] ??
        text(row.payment_status),
      fulfillmentStatus: text(row.fulfillment_status),
      fulfillmentStatusLabel:
        FULFILLMENT_STATUS_LABELS[
          text(row.fulfillment_status) as keyof typeof FULFILLMENT_STATUS_LABELS
        ] ?? text(row.fulfillment_status),
      totalAmount: num(row.total_amount),
      itemCount: num(row.item_count),
      createdAt: date(row.created_at),
      paidAt: date(row.paid_at),
      customerLabel: text(row.email),
      trackingToken: text(row.tracking_token),
    };
  }
}

function requirePiiAccess(ctx: RequestContext): boolean {
  return ctx.isStaff && ctx.permissions.has("customer.pii.view");
}

export async function adminGetOrder(
  ctx: RequestContext,
  orderId: string,
): Promise<CustomerOrderDetail & { payments: PaymentAttemptSummary[]; refunds: RefundSummary[] }> {
  requirePermission(ctx, "order.view");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(`SELECT * FROM orders WHERE id = $1`, [
    orderId,
  ]);
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Pesanan tidak ditemukan.", { status: 404 });
  const detail = await buildOrderDetail(row, { includeInternalNotes: true });
  const [paymentsRes, refundsRes] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT * FROM payment_attempts WHERE order_id = $1 ORDER BY created_at DESC`,
      [orderId],
    ),
    db.query<Record<string, unknown>>(
      `SELECT * FROM refunds WHERE order_id = $1 ORDER BY created_at DESC`,
      [orderId],
    ),
  ]);
  return {
    ...detail,
    payments: paymentsRes.rows.map((p) => ({
      id: text(p.id),
      provider: text(p.provider_code),
      method: text(p.method_name),
      amount: num(p.amount),
      amountLabel: formatIDR(num(p.amount)),
      status: text(p.status),
      providerRef: optText(p.provider_ref),
      isSimulated: bool(p.is_simulated),
      createdAt: date(p.created_at),
      succeededAt: date(p.succeeded_at),
      instructions: optText(p.instructions),
    })),
    refunds: refundsRes.rows.map((r) => ({
      id: text(r.id),
      reference: text(r.reference),
      amount: num(r.amount),
      amountLabel: formatIDR(num(r.amount)),
      status: text(r.status),
      reason: text(r.reason),
      includeShipping: bool(r.include_shipping),
      providerRef: optText(r.provider_ref),
      createdAt: date(r.created_at),
      succeededAt: date(r.succeeded_at),
    })),
  };
}

export interface PaymentAttemptSummary {
  id: string;
  provider: string;
  method: string;
  amount: number;
  amountLabel: string;
  status: string;
  providerRef: string | null;
  isSimulated: boolean;
  createdAt: Date | null;
  succeededAt: Date | null;
  instructions: string | null;
}

export interface RefundSummary {
  id: string;
  reference: string;
  amount: number;
  amountLabel: string;
  status: string;
  reason: string;
  includeShipping: boolean;
  providerRef: string | null;
  createdAt: Date | null;
  succeededAt: Date | null;
}

export async function listCustomerPayments(
  ctx: RequestContext,
  orderId: string,
): Promise<PaymentAttemptSummary[]> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT pa.* FROM payment_attempts pa JOIN orders o ON o.id = pa.order_id
      WHERE pa.order_id = $1 AND (o.customer_id = $2 OR o.tracking_token = $3) ORDER BY pa.created_at DESC`,
    [orderId, ctx.user?.id ?? null, ""],
  );
  return res.rows.map((p) => ({
    id: text(p.id),
    provider: text(p.provider_code),
    method: text(p.method_name),
    amount: num(p.amount),
    amountLabel: formatIDR(num(p.amount)),
    status: text(p.status),
    providerRef: optText(p.provider_ref),
    isSimulated: bool(p.is_simulated),
    createdAt: date(p.created_at),
    succeededAt: date(p.succeeded_at),
    instructions: optText(p.instructions),
  }));
}

export function describeAllowedActions(
  order: OrderSnapshot,
): Array<{ to: OrderStatus; label: string }> {
  return allowedTransitions(order.status).map((t) => ({
    to: t.to,
    label: ORDER_STATUS_LABELS[t.to] ?? t.to,
  }));
}

export function orderOptNumValue(value: unknown): number | null {
  return optNum(value);
}
