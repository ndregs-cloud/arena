import "server-only";
import { systemClock } from "@/domain/clock";
import { AppError } from "@/domain/errors";
import {
  assertAttemptTransition,
  assertEventMatchesAttempt,
  assertRefundTransition,
  assertWithinRefundable,
  isTerminal,
  paymentMethodLabel,
  refundableAmountOfOrder,
  requiresApproval,
  webhookDedupeKey,
  type PaymentAttempt,
  type PaymentAttemptStatus,
  type RefundStatus,
} from "@/domain/payments";
import { assertTransitionAllowed, findTransition, type OrderStatus } from "@/domain/orders";
import { generateReference } from "@/domain/ids";
import { writeAudit } from "@/platform/audit";
import { paymentProvider } from "@/platform/payment";
import { date, getDb, jsonb, num, optText, text, type Tx } from "@/platform/db";
import { env } from "@/platform/env";
import { enqueueNotification } from "@/platform/notifications";
import { formatIDR } from "@/lib/format";
import { requirePermission } from "@/server/context";
import type { RequestContext } from "@/server/context";
import { expireReservations } from "@/server/services/inventory.service";
import { releasePromotion } from "@/server/services/promotion.service";

/**
 * Pembayaran: attempt, webhook, rekonsiliasi, refund (Blueprint §6.2-§6.3).
 * Aturan keras:
 *  - status 'succeeded' HANYA dari respons API provider / webhook terverifikasi;
 *  - webhook duplikat menjadi no-op (unique provider+event_id, AT-04);
 *  - return URL browser tidak mengubah status (AT-05);
 *  - refund melewati ledger sendiri dan tidak melebihi refundable (AT-08).
 */

interface AttemptRow extends PaymentAttempt {}

async function loadAttempt(attemptId: string): Promise<AttemptRow> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT pa.*, o.order_number, o.status AS order_status, o.payment_status AS order_payment_status, o.id AS oid
       FROM payment_attempts pa JOIN orders o ON o.id = pa.order_id WHERE pa.id = $1`,
    [attemptId],
  );
  const row = res.rows[0];
  if (!row)
    throw new AppError("NOT_FOUND", "Percobaan pembayaran tidak ditemukan.", { status: 404 });
  return {
    id: text(row.id),
    orderId: text(row.order_id),
    orderNumber: text(row.order_number),
    providerCode: text(row.provider_code) as AttemptRow["providerCode"],
    providerRef: optText(row.provider_ref),
    methodCode: text(row.method_code),
    methodName: text(row.method_name),
    amount: num(row.amount),
    currency: "IDR",
    status: text(row.status) as PaymentAttemptStatus,
    idempotencyKey: text(row.idempotency_key),
    createdAt: date(row.created_at) ?? new Date(),
    updatedAt: date(row.updated_at) ?? new Date(),
    succeededAt: date(row.succeeded_at),
    instructions: optText(row.instructions),
    redirectUrl: optText(row.redirect_url),
    isSimulated: Boolean(row.is_simulated),
    failureReason: optText(row.failure_reason),
  };
}

/** Buat/aktifkan attempt di provider (hosted/simulated). Aman untuk retry: idempotency key sudah tercatat. */
export async function initiatePayment(
  ctx: RequestContext,
  attemptId: string,
  options: { simScenario?: string } = {},
): Promise<{
  status: PaymentAttemptStatus;
  redirectUrl: string | null;
  instructions: string | null;
  isSimulated: boolean;
}> {
  const provider = paymentProvider();
  const attempt = await loadAttempt(attemptId);
  if (isTerminal(attempt.status)) {
    return {
      status: attempt.status,
      redirectUrl: attempt.redirectUrl,
      instructions: attempt.instructions,
      isSimulated: attempt.isSimulated,
    };
  }
  const db = await getDb();
  const result = await provider.createAttempt({
    attemptId: attempt.id,
    orderNumber: attempt.orderNumber,
    amount: attempt.amount,
    currency: "IDR",
    methodCode: attempt.methodCode,
    customerEmail: attempt.orderNumber ? "" : "",
    customerName: "",
    returnUrl: `${env.appUrl}/kembali-pembayaran/${attempt.id}`,
    webhookUrl: `${env.appUrl}/api/webhooks/payments/${provider.code}`,
    scenario: options.simScenario,
  });

  await db.query(
    `UPDATE payment_attempts SET provider_ref = $2, status = $3, instructions = $4, redirect_url = $5, updated_at = now(), failure_reason = $6
      WHERE id = $1`,
    [
      attempt.id,
      result.providerRef,
      result.status,
      result.instructions,
      result.redirectUrl,
      result.status === "failed" ? "Ditolak penyedia (simulasi)" : null,
    ],
  );
  await db.query(
    `UPDATE orders SET payment_status = CASE WHEN payment_status = 'succeeded' THEN payment_status ELSE $2::text END, updated_at = now() WHERE id = $1`,
    [
      attempt.orderId,
      result.status === "succeeded"
        ? "succeeded"
        : result.status === "failed"
          ? "failed"
          : "pending",
    ],
  );

  if (result.status === "succeeded") {
    // Konfirmasi datang dari respons API provider (server-side), bukan dari browser.
    await applyPaymentSucceeded(ctx, {
      attemptId: attempt.id,
      providerRef: result.providerRef,
      eventId: `api:${result.providerRef}`,
      source: "provider",
    });
  }
  return {
    status: result.status,
    redirectUrl: result.redirectUrl,
    instructions: result.instructions,
    isSimulated: provider.isSimulated,
  };
}

export interface WebhookIngestResult {
  outcome: "processed" | "duplicate" | "ignored" | "rejected" | "needs_review";
  message: string;
}

/** Ingest webhook: verifikasi signature atas RAW BODY, dedup, lalu proses. 202/200 selalu aman (Blueprint §11.3). */
export async function ingestPaymentWebhook(
  rawBody: string,
  signature: string | null,
  ctx: RequestContext,
): Promise<WebhookIngestResult> {
  const provider = paymentProvider();
  const verification = provider.verifyWebhook(rawBody, signature);
  const db = await getDb();
  if (!verification.valid) {
    await db.query(
      `INSERT INTO payment_webhook_events (provider_code, event_id, event_type, signature_valid, status, payload, error_code)
       VALUES ($1,$2,$3,false,'rejected',$4::jsonb,$5) ON CONFLICT (provider_code, event_id) DO NOTHING`,
      [
        provider.code,
        `unsigned-${Date.now()}`,
        verification.reason ?? "INVALID_SIGNATURE",
        JSON.stringify({ length: rawBody.length }),
        verification.reason ?? "INVALID_SIGNATURE",
      ],
    );
    throw new AppError("PERMISSION_DENIED", "Webhook ditolak: signature tidak valid.", {
      status: 403,
    });
  }

  const event = provider.normalizeEvent(verification.payload ?? {});
  if (!event) {
    await db.query(
      `INSERT INTO payment_webhook_events (provider_code, event_id, event_type, signature_valid, status, payload)
       VALUES ($1,$2,$3,true,'ignored',$4::jsonb) ON CONFLICT (provider_code, event_id) DO NOTHING`,
      [
        provider.code,
        verification.eventId ?? `unknown-${Date.now()}`,
        "unknown",
        JSON.stringify({ note: "event tidak dikenali" }),
      ],
    );
    return { outcome: "ignored", message: "Event tidak dikenali dan dicatat untuk peninjauan." };
  }

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO payment_webhook_events (provider_code, event_id, event_type, attempt_ref, amount, currency, signature_valid, status, payload)
     VALUES ($1,$2,$3,$4,$5,$6,true,'received',$7::jsonb)
     ON CONFLICT (provider_code, event_id) DO NOTHING
     RETURNING id`,
    [
      provider.code,
      event.eventId,
      event.kind,
      event.providerRef,
      event.amount,
      event.currency,
      JSON.stringify({
        amount: event.amount,
        status: event.status,
        occurredAt: event.occurredAt.toISOString(),
      }),
    ],
  );
  if (inserted.rows.length === 0) {
    return {
      outcome: "duplicate",
      message: "Event sudah pernah diproses; tidak ada perubahan ganda.",
    };
  }
  const webhookRowId = String(inserted.rows[0]?.id);

  const attemptRes = await db.query<{
    id: string;
    amount: unknown;
    currency: unknown;
    order_id: string;
    status: unknown;
  }>(
    `SELECT id, amount, currency, order_id, status FROM payment_attempts WHERE provider_code = $1 AND provider_ref = $2 LIMIT 1`,
    [provider.code, event.providerRef],
  );
  const attemptRow = attemptRes.rows[0];
  if (!attemptRow) {
    await db.query(
      "UPDATE payment_webhook_events SET status='needs_review', error_code=$2 WHERE id=$1",
      [webhookRowId, "PAYMENT_WITHOUT_ATTEMPT"],
    );
    return {
      outcome: "needs_review",
      message: "Event tidak terhubung ke attempt lokal; masuk antrean eksepsi.",
    };
  }

  try {
    assertEventMatchesAttempt(
      {
        provider: provider.code,
        eventId: event.eventId,
        kind: event.kind as never,
        attemptRef: event.providerRef,
        amount: event.amount,
        currency: "IDR",
        occurredAt: event.occurredAt,
        rawSummary: {},
      },
      {
        ...(await loadAttempt(String(attemptRow.id))),
        amount: num(attemptRow.amount),
      },
    );
  } catch (error) {
    await db.query(
      "UPDATE payment_webhook_events SET status='needs_review', error_code=$2 WHERE id=$1",
      [webhookRowId, error instanceof AppError ? error.code : "AMOUNT_MISMATCH"],
    );
    return {
      outcome: "needs_review",
      message: "Nominal/mata uang tidak cocok; dimasukkan ke antrean eksepsi untuk rekonsiliasi.",
    };
  }

  if (event.kind.startsWith("refund")) {
    await applyRefundEvent(
      ctx,
      event.providerRef,
      event.status === "succeeded" ? "succeeded" : "failed",
    );
    await db.query(
      "UPDATE payment_webhook_events SET status='processed', processed_at=now(), order_id=$2 WHERE id=$1",
      [webhookRowId, String(attemptRow.order_id)],
    );
    return { outcome: "processed", message: "Status refund diperbarui." };
  }

  if (event.status === "succeeded") {
    await applyPaymentSucceeded(ctx, {
      attemptId: String(attemptRow.id),
      providerRef: event.providerRef,
      eventId: event.eventId,
      source: "provider",
    });
  } else if (event.status === "failed" || event.status === "expired") {
    await applyPaymentFailed(ctx, String(attemptRow.id), event.status);
  } else {
    await db.query(
      "UPDATE payment_attempts SET status='pending', updated_at=now() WHERE id=$1 AND status IN ('created','pending','requires_action')",
      [String(attemptRow.id)],
    );
  }
  await db.query(
    "UPDATE payment_webhook_events SET status='processed', processed_at=now(), order_id=$2 WHERE id=$1",
    [webhookRowId, String(attemptRow.order_id)],
  );
  return { outcome: "processed", message: "Event diproses." };
}

/**
 * Terapkan "pembayaran berhasil" SEKALI untuk attempt tertentu.
 * Idempoten: attempt yang sudah succeeded menjadi no-op (AT-04).
 */
async function applyPaymentSucceeded(
  ctx: RequestContext,
  input: {
    attemptId: string;
    providerRef: string;
    eventId: string;
    source: "provider" | "inquiry";
  },
): Promise<void> {
  const db = await getDb();
  const now = systemClock.now();
  const changed = await db.transaction(async (tx) => {
    const res = await tx.query<{ order_id: string; status: string; amount: unknown }>(
      `UPDATE payment_attempts SET status='succeeded', succeeded_at=$2, updated_at=now(), provider_ref=COALESCE(provider_ref,$3)
        WHERE id=$1 AND status <> 'succeeded'
        RETURNING order_id, status, amount`,
      [input.attemptId, now.toISOString(), input.providerRef],
    );
    const row = res.rows[0];
    if (!row) return null; // sudah succeeded -> no-op
    const orderId = String(row.order_id);
    const orderRes = await tx.query<Record<string, unknown>>(
      `SELECT * FROM orders WHERE id=$1 FOR UPDATE`,
      [orderId],
    );
    const order = orderRes.rows[0];
    if (!order) throw new AppError("NOT_FOUND", "Order tidak ditemukan.", { status: 404 });

    await tx.query(
      `UPDATE orders SET payment_status='succeeded', paid_at = COALESCE(paid_at, $2), updated_at=now() WHERE id=$1`,
      [orderId, now.toISOString()],
    );

    const currentStatus = text(order.status) as OrderStatus;
    const transition = findTransition(currentStatus, "paid");
    if (transition) {
      await tx.query(`UPDATE orders SET status='paid', updated_at=now() WHERE id=$1`, [orderId]);
      await tx.query(
        `INSERT INTO order_events (order_id, event_type, from_status, to_status, actor_kind, visibility, note, data, request_id)
         VALUES ($1,'payment_succeeded',$2,'paid','provider','customer',$3,$4::jsonb,$5)`,
        [
          orderId,
          currentStatus,
          `Pembayaran terkonfirmasi (${input.source}).`,
          JSON.stringify({ providerRef: input.providerRef, eventId: input.eventId }),
          ctx.requestId,
        ],
      );
    } else {
      // Kasus AT-06: payment datang setelah order dibatalkan -> JANGAN lepas ke gudang, tandai eksepsi.
      await tx.query(
        `INSERT INTO order_events (order_id, event_type, from_status, to_status, actor_kind, visibility, note, request_id)
         VALUES ($1,'payment_reconciliation_needed',$2,$2,'provider','internal',$3,$4)`,
        [
          orderId,
          currentStatus,
          `Pembayaran terkonfirmasi tetapi order berstatus ${currentStatus}; perlu rekonsiliasi manual (refund/pembatalan ulang).`,
          ctx.requestId,
        ],
      );
      await tx.query(
        `INSERT INTO integration_outbox (kind, destination, payload, idempotency_key, status)
         VALUES ('payment.exception','finance',$1::jsonb,$2,'pending')`,
        [
          JSON.stringify({ orderId, reason: "paid_after_cancel", status: currentStatus }),
          `payexc:${orderId}:${input.eventId}`,
        ],
      );
    }

    await tx.query(
      `UPDATE products SET popularity = popularity + oi.quantity FROM order_items oi WHERE oi.order_id = $1 AND oi.product_id = products.id`,
      [orderId],
    );
    return { orderId, amount: num(row.amount) };
  });

  if (!changed) return;

  const orderRes = await db.query<Record<string, unknown>>(
    `SELECT order_number, email, total_amount FROM orders WHERE id=$1`,
    [changed.orderId],
  );
  const orderRow = orderRes.rows[0] ?? {};
  await enqueueNotification({
    kind: "payment_succeeded",
    to: text(orderRow.email, ""),
    orderId: changed.orderId,
    vars: {
      orderNumber: text(orderRow.order_number),
      total: formatIDR(num(orderRow.total_amount)),
    },
  });
  await writeAudit({
    actorId: ctx.user?.id ?? null,
    actorEmail: ctx.user?.email ?? null,
    actorKind: "system",
    action: "payment.succeeded",
    targetType: "order",
    targetId: changed.orderId,
    afterData: { amount: changed.amount, providerRef: input.providerRef, eventId: input.eventId },
    requestId: ctx.requestId,
  });
}

async function applyPaymentFailed(
  ctx: RequestContext,
  attemptId: string,
  status: "failed" | "expired",
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const res = await tx.query<{ order_id: string }>(
      `UPDATE payment_attempts SET status=$2, updated_at=now() WHERE id=$1 AND status NOT IN ('succeeded','refunded') RETURNING order_id`,
      [attemptId, status],
    );
    const orderId = res.rows[0]?.order_id ? String(res.rows[0].order_id) : null;
    if (!orderId) return;
    await tx.query(
      `UPDATE orders SET payment_status = $2, updated_at=now() WHERE id=$1 AND payment_status <> 'succeeded'`,
      [orderId, status === "expired" ? "expired" : "failed"],
    );
    await tx.query(
      `INSERT INTO order_events (order_id, event_type, actor_kind, visibility, note, request_id)
       VALUES ($1,$2,'provider','customer',$3,$4)`,
      [
        orderId,
        status === "expired" ? "payment_expired" : "payment_failed",
        status === "expired"
          ? "Batas waktu pembayaran habis."
          : "Pembayaran gagal; pelanggan dapat mencoba metode lain.",
        ctx.requestId,
      ],
    );
    const orderRes = await tx.query<Record<string, unknown>>(
      `SELECT email, order_number FROM orders WHERE id=$1`,
      [orderId],
    );
    const row = orderRes.rows[0];
    if (row) {
      await tx.query(
        "INSERT INTO notification_outbox (kind, channel, to_address, subject, body, template, payload, status) VALUES ($1,'email',$2,$3,$4,$1,$5::jsonb,'queued')",
        [
          "payment_failed",
          text(row.email, ""),
          `Pembayaran ${text(row.order_number)} belum berhasil`,
          "Pembayaran belum berhasil. Anda masih dapat menyelesaikan pembayaran melalui halaman pesanan.",
          JSON.stringify({ orderNumber: text(row.order_number) }),
        ],
      );
    }
  });
}

/**
 * Penanganan return URL browser. TIDAK mengubah status berdasarkan query string;
 * hanya melakukan inquiry server-side lalu menampilkan status sebenarnya (AT-05).
 */
export async function handleBrowserReturn(
  ctx: RequestContext,
  attemptId: string,
): Promise<{ status: PaymentAttemptStatus; orderStatus: OrderStatus; message: string }> {
  const provider = paymentProvider();
  const attempt = await loadAttempt(attemptId);
  if (attempt.status === "succeeded" || !attempt.providerRef) {
    const orderRes = await (
      await getDb()
    ).query<Record<string, unknown>>(`SELECT status FROM orders WHERE id=$1`, [attempt.orderId]);
    return {
      status: attempt.status,
      orderStatus: text(
        orderRes.rows[0]?.status,
        attempt.status === "succeeded" ? "paid" : "pending_payment",
      ) as OrderStatus,
      message:
        attempt.status === "succeeded"
          ? "Pembayaran sudah terkonfirmasi sebelumnya."
          : "Status belum dapat dikonfirmasi.",
    };
  }
  const inquiry = await provider.inquire(attempt.providerRef);
  const db = await getDb();
  if (!inquiry) {
    return {
      status: attempt.status,
      orderStatus: (await orderStatusOf(attempt.orderId)) as OrderStatus,
      message: "Inquiry provider tidak mengembalikan data; status tetap menunggu konfirmasi.",
    };
  }
  if (inquiry.status === "succeeded") {
    await applyPaymentSucceeded(ctx, {
      attemptId,
      providerRef: attempt.providerRef,
      eventId: `inquiry:${inquiry.rawEventId}`,
      source: "inquiry",
    });
    return {
      status: "succeeded",
      orderStatus: (await orderStatusOf(attempt.orderId)) as OrderStatus,
      message: "Pembayaran terkonfirmasi lewat inquiry server-side.",
    };
  }
  if (inquiry.status === "failed" || inquiry.status === "expired") {
    await applyPaymentFailed(ctx, attemptId, inquiry.status === "expired" ? "expired" : "failed");
    return {
      status: inquiry.status,
      orderStatus: (await orderStatusOf(attempt.orderId)) as OrderStatus,
      message: "Provider menyatakan pembayaran belum berhasil.",
    };
  }
  await db.query("UPDATE payment_attempts SET updated_at = now() WHERE id=$1", [attemptId]);
  return {
    status: "pending",
    orderStatus: (await orderStatusOf(attempt.orderId)) as OrderStatus,
    message: "Menunggu konfirmasi dari penyedia pembayaran.",
  };
}

async function orderStatusOf(orderId: string): Promise<string> {
  const db = await getDb();
  const res = await db.query<{ status: unknown }>(`SELECT status FROM orders WHERE id=$1`, [
    orderId,
  ]);
  return text(res.rows[0]?.status, "pending_payment");
}

/** Rekonsiliasi berkala: inquiry attempt yang menggantung, tutup yang lewat batas, catat eksepsi. */
export async function reconcileOpenAttempts(
  limit = 50,
): Promise<{ checked: number; settled: number; exceptions: number }> {
  const db = await getDb();
  const provider = paymentProvider();
  const res = await db.query<{ id: string; provider_ref: string | null }>(
    `SELECT pa.id, pa.provider_ref FROM payment_attempts pa
      WHERE pa.status IN ('created','pending','requires_action') AND pa.created_at < now() - interval '5 minutes'
      ORDER BY pa.created_at LIMIT $1`,
    [limit],
  );
  let settled = 0;
  let exceptions = 0;
  for (const row of res.rows) {
    if (!row.provider_ref) continue;
    const inquiry = await provider.inquire(row.provider_ref);
    if (!inquiry) {
      exceptions += 1;
      await db.query(
        `INSERT INTO integration_outbox (kind, destination, payload, idempotency_key)
         VALUES ('payment.exception','finance',$1::jsonb,$2) ON CONFLICT DO NOTHING`,
        [
          JSON.stringify({ attemptId: row.id, reason: "inquiry_empty" }),
          `payexc:inquiry:${row.id}`,
        ],
      );
      continue;
    }
    if (
      inquiry.status === "succeeded" ||
      inquiry.status === "failed" ||
      inquiry.status === "expired"
    ) {
      await db.query(
        "UPDATE payment_attempts SET status=$2, updated_at=now() WHERE id=$1 AND status NOT IN ('succeeded','refunded')",
        [row.id, inquiry.status === "succeeded" ? "succeeded" : inquiry.status],
      );
      settled += 1;
    }
  }
  return { checked: res.rows.length, settled, exceptions };
}

/** Tutup attempt + order yang melewati batas waktu bayar (dipanggil job/API). */
export async function expireUnpaidOrders(): Promise<{
  orders: number;
  reservationsReleased: number;
}> {
  const db = await getDb();
  const res = await db.query<{ id: string }>(
    `SELECT id FROM orders WHERE status = 'pending_payment' AND payment_status <> 'succeeded' AND expires_at IS NOT NULL AND expires_at < now() LIMIT 100`,
  );
  let orders = 0;
  for (const row of res.rows) {
    const orderId = String(row.id);
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE orders SET status='cancelled', cancelled_at=now(), updated_at=now(), payment_status='expired', cancel_reason='Batas waktu pembayaran habis' WHERE id=$1 AND status='pending_payment'`,
        [orderId],
      );
      await tx.query(
        `UPDATE payment_attempts SET status='expired', updated_at=now() WHERE order_id=$1 AND status IN ('created','pending','requires_action')`,
        [orderId],
      );
      await tx.query(
        `INSERT INTO order_events (order_id, event_type, from_status, to_status, actor_kind, visibility, note) VALUES ($1,'order_expired','pending_payment','cancelled','job','internal','Dibatalkan otomatis: batas waktu pembayaran habis.')`,
        [orderId],
      );
    });
    await releaseReservationsForOrder(orderId, "expired");
    await releasePromotion(orderId);
    orders += 1;
  }
  const released = await expireReservations();
  return { orders, reservationsReleased: released.released };
}

export async function releaseReservationsForOrder(
  orderId: string,
  reason: "released" | "expired",
  executor?: Tx,
): Promise<void> {
  // Executor = transaksi pemanggil. Memakai koneksi pool di dalam transaksi membuat query
  // berjalan di connection lain (data tak terlihat + risiko deadlock baris yang dikunci).
  const db = executor ?? (await getDb());
  const res = await db.query<{ location_code: string; sku: string; quantity: number }>(
    `SELECT location_code, sku, quantity FROM stock_reservations WHERE order_id = $1 AND status = 'active'`,
    [orderId],
  );
  for (const row of res.rows) {
    await db.query("SELECT fn_release_stock($1,$2,$3)", [row.location_code, row.sku, row.quantity]);
    await db.query(
      `INSERT INTO inventory_movements (location_code, sku, kind, quantity, balance_before, balance_after, reason_code, note, ref_type, ref_id)
       SELECT $1,$2,'release',$3::integer, b.on_hand - b.reserved, b.on_hand - b.reserved + $3::integer, 'wrong_entry_fix', $4, 'order', $5
         FROM inventory_balances b WHERE b.location_code=$1 AND b.sku=$2`,
      [
        row.location_code,
        row.sku,
        row.quantity,
        reason === "expired" ? "Reservasi kedaluwarsa" : "Reservasi dilepas (pembatalan)",
        orderId,
      ],
    );
  }
  await db.query(
    "UPDATE stock_reservations SET status=$2, resolved_at=now() WHERE order_id=$1 AND status='active'",
    [orderId, reason],
  );
}

export async function consumeReservationsForOrder(orderId: string, executor?: Tx): Promise<void> {
  const db = executor ?? (await getDb());
  const res = await db.query<{ location_code: string; sku: string; quantity: number }>(
    `SELECT location_code, sku, quantity FROM stock_reservations WHERE order_id = $1 AND status='active'`,
    [orderId],
  );
  for (const row of res.rows) {
    await db.query("SELECT fn_consume_stock($1,$2,$3)", [row.location_code, row.sku, row.quantity]);
    await db.query(
      `INSERT INTO inventory_movements (location_code, sku, kind, quantity, balance_before, balance_after, reason_code, ref_type, ref_id)
       SELECT $1,$2,'ship',$3::integer, b.on_hand, b.on_hand - $3::integer, 'wrong_entry_fix', 'order', $4 FROM inventory_balances b WHERE b.location_code=$1 AND b.sku=$2`,
      [row.location_code, row.sku, row.quantity, orderId],
    );
  }
  await db.query(
    "UPDATE stock_reservations SET status='consumed', resolved_at=now() WHERE order_id=$1 AND status='active'",
    [orderId],
  );
}

// ---------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------

export interface RefundRow {
  id: string;
  reference: string;
  orderId: string;
  orderNumber: string;
  amount: number;
  status: RefundStatus;
  reason: string;
  includeShipping: boolean;
  requestedBy: string | null;
  approvedBy: string | null;
  providerRefundRef: string | null;
  createdAt: Date | null;
  succeededAt: Date | null;
}

function mapRefund(row: Record<string, unknown>): RefundRow {
  return {
    id: text(row.id),
    reference: text(row.reference),
    orderId: text(row.order_id),
    orderNumber: text(row.order_number),
    amount: num(row.amount),
    status: text(row.status) as RefundStatus,
    reason: text(row.reason),
    includeShipping: Boolean(row.include_shipping),
    requestedBy: optText(row.requested_by),
    approvedBy: optText(row.approved_by),
    providerRefundRef: optText(row.provider_ref),
    createdAt: date(row.created_at),
    succeededAt: date(row.succeeded_at),
  };
}

/**
 * Ajukan refund. Refund di bawah ambang dapat langsung disubmit oleh peran finance;
 * di atas ambang wajib disetujui aktor berbeda (maker-checker, Blueprint §3.1).
 */
export async function requestRefund(
  ctx: RequestContext,
  input: {
    orderId: string;
    amount: number;
    reason: string;
    includeShipping?: boolean;
    returnId?: string | null;
    items?: Array<{ orderItemId: string; quantity: number; amount: number }>;
  },
): Promise<{ refund: RefundRow; awaitingApproval: boolean; message: string }> {
  requirePermission(ctx, "order.refund");
  const db = await getDb();
  const orderRes = await db.query<Record<string, unknown>>(
    `SELECT * FROM orders WHERE id=$1 FOR UPDATE`,
    [input.orderId],
  );
  const order = orderRes.rows[0];
  if (!order) throw new AppError("NOT_FOUND", "Order tidak ditemukan.", { status: 404 });
  const refundable = refundableAmountOfOrder(num(order.total_amount), num(order.refunded_amount));
  assertWithinRefundable(input.amount, refundable);

  const needsApproval = requiresApproval(
    input.amount,
    env.refundAutoApproveLimit,
    ctx.user?.id ?? "anon",
    null,
  );
  const reference = generateReference("REF");
  const refundId = await createRefundRow(db, {
    reference,
    orderId: input.orderId,
    returnId: input.returnId ?? null,
    amount: input.amount,
    status: needsApproval ? "requested" : "approved",
    reason: input.reason,
    includeShipping: input.includeShipping ?? false,
    requesterId: ctx.user?.id ?? null,
    // Auto-approve di bawah ambang BUKAN persetujuan manusia: approved_by dibiarkan NULL supaya
    // pemisahan tugas (CHECK refunds: approved_by <> requested_by) tetap berlaku dan audit trail
    // tidak mengklaim ada penyetuju kedua.
    approverId: null,
    idempotencyKey: ctx.requestId,
    items: input.items ?? [],
  });

  const result = await db.query<Record<string, unknown>>(
    `SELECT r.*, o.order_number FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.id = $1`,
    [refundId],
  );
  const refund = mapRefund(result.rows[0]!);
  return {
    refund,
    awaitingApproval: needsApproval,
    message: needsApproval
      ? `Refund ${formatIDR(input.amount)} diajukan dan menunggu persetujuan penyetuju (di atas ambang ${formatIDR(env.refundAutoApproveLimit)}).`
      : `Refund ${formatIDR(input.amount)} disetujui dan siap dikirim ke penyedia pembayaran.`,
  };
}

async function createRefundRow(
  db: { query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> },
  input: {
    reference: string;
    orderId: string;
    returnId: string | null;
    amount: number;
    status: RefundStatus;
    reason: string;
    includeShipping: boolean;
    requesterId: string | null;
    approverId: string | null;
    idempotencyKey: string;
    items: Array<{ orderItemId: string; quantity: number; amount: number }>;
  },
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO refunds (reference, order_id, payment_attempt_id, return_id, amount, currency, status, reason, include_shipping, requested_by, approved_by, approved_at, idempotency_key)
     VALUES ($1,$2,(SELECT id FROM payment_attempts WHERE order_id=$2 AND status='succeeded' ORDER BY succeeded_at DESC LIMIT 1),$3,$4,'IDR',$5,$6,$7,$8,$9, CASE WHEN $9::uuid IS NOT NULL THEN now() ELSE NULL END, $10)
     RETURNING id`,
    [
      input.reference,
      input.orderId,
      input.returnId,
      input.amount,
      input.status,
      input.reason,
      input.includeShipping,
      input.requesterId,
      input.approverId,
      input.idempotencyKey,
    ],
  );
  const refundId = String(res.rows[0]?.id);
  for (const item of input.items) {
    await db.query(
      `INSERT INTO refund_items (refund_id, order_item_id, quantity, amount) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [refundId, item.orderItemId, item.quantity, item.amount],
    );
  }
  return refundId;
}

export async function approveRefund(
  ctx: RequestContext,
  refundId: string,
  decision: "approved" | "rejected",
  note: string,
): Promise<RefundRow> {
  requirePermission(ctx, "refund.approve");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM refunds WHERE id=$1 FOR UPDATE`,
    [refundId],
  );
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Refund tidak ditemukan.", { status: 404 });
  const status = text(row.status) as RefundStatus;
  assertRefundTransition(status, decision === "approved" ? "approved" : "rejected");
  const requesterId = optText(row.requested_by);
  if (ctx.user && requesterId === ctx.user.id) {
    throw new AppError(
      "APPROVAL_REQUIRED",
      "Penyetuju harus berbeda dari pengaju (pemisahan tugas).",
      { status: 422 },
    );
  }
  await db.query(
    "UPDATE refunds SET status=$2, approved_by=$3, approved_at=now(), reason = reason || ' | ' || COALESCE($4,'') WHERE id=$1",
    [refundId, decision === "approved" ? "approved" : "rejected", ctx.user?.id ?? null, note],
  );
  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: `refund.${decision}`,
    targetType: "refund",
    targetId: refundId,
    afterData: { status: decision, note },
    reason: note,
    requestId: ctx.requestId,
  });
  const after = await db.query<Record<string, unknown>>(
    `SELECT r.*, o.order_number FROM refunds r JOIN orders o ON o.id=r.order_id WHERE r.id=$1`,
    [refundId],
  );
  return mapRefund(after.rows[0]!);
}

/** Kirim refund ke provider (simulasi) -> status submitted/pending. */
export async function submitRefund(ctx: RequestContext, refundId: string): Promise<RefundRow> {
  requirePermission(ctx, "order.refund");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(`SELECT * FROM refunds WHERE id=$1`, [
    refundId,
  ]);
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Refund tidak ditemukan.", { status: 404 });
  const status = text(row.status) as RefundStatus;
  if (status !== "approved")
    throw new AppError("INVALID_STATE_TRANSITION", "Refund harus disetujui sebelum dikirim.", {
      status: 422,
    });
  const provider = paymentProvider();
  const attemptRes = await db.query<Record<string, unknown>>(
    `SELECT provider_ref FROM payment_attempts WHERE id=$1`,
    [text(row.payment_attempt_id ?? "00000000-0000-0000-0000-000000000000")],
  );
  const providerRef = text(attemptRes.rows[0]?.provider_ref ?? "");
  const result = await provider.requestRefund({
    attemptRef: providerRef,
    amount: num(row.amount),
    currency: "IDR",
    idempotencyKey: text(row.idempotency_key ?? refundId),
  });
  await db.query(
    `UPDATE refunds SET status='pending', provider_ref=$2, updated_at=now() WHERE id=$1`,
    [refundId, result.providerRefundRef],
  );
  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: "refund.submitted",
    targetType: "refund",
    targetId: refundId,
    afterData: { providerRefundRef: result.providerRefundRef, isSimulated: result.isSimulated },
    requestId: ctx.requestId,
  });
  const after = await db.query<Record<string, unknown>>(
    `SELECT r.*, o.order_number FROM refunds r JOIN orders o ON o.id=r.order_id WHERE r.id=$1`,
    [refundId],
  );
  return mapRefund(after.rows[0]!);
}

/** Konfirmasi refund selesai (dari webhook provider atau verifikasi manual finance). */
export async function settleRefund(
  ctx: RequestContext,
  refundId: string,
  options: { providerConfirmed?: boolean } = {},
): Promise<void> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM refunds WHERE id=$1 FOR UPDATE`,
    [refundId],
  );
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Refund tidak ditemukan.", { status: 404 });
  const status = text(row.status) as RefundStatus;
  if (status === "succeeded") return;
  if (!["pending", "submitted", "approved"].includes(status)) {
    throw new AppError(
      "INVALID_STATE_TRANSITION",
      "Refund belum dapat diselesaikan pada tahap ini.",
      { status: 422 },
    );
  }
  if (!options.providerConfirmed) {
    // Blueprint §6.3: jangan beri label refunded sebelum konfirmasi provider, KECUALI mode simulasi.
    if (!paymentProvider().isSimulated) {
      throw new AppError(
        "PAYMENT_NOT_CONFIRMED",
        "Refund belum terkonfirmasi penyedia. Jangan menandai selesai.",
        { status: 422 },
      );
    }
  }
  const orderId = text(row.order_id);
  const amount = num(row.amount);
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE refunds SET status='succeeded', succeeded_at=now(), updated_at=now() WHERE id=$1`,
      [refundId],
    );
    const upd = await tx.query<{ total_amount: unknown; refunded_amount: unknown }>(
      `UPDATE orders SET refunded_amount = refunded_amount + $2,
              payment_status = CASE WHEN refunded_amount + $2 >= total_amount THEN 'refunded' ELSE 'partially_refunded' END,
              updated_at = now()
        WHERE id = $1 RETURNING total_amount, refunded_amount`,
      [orderId, amount],
    );
    const after = upd.rows[0];
    if (after) {
      const fullyRefunded = num(after.refunded_amount) >= num(after.total_amount);
      await tx.query(
        `INSERT INTO order_events (order_id, event_type, actor_kind, visibility, note, data, request_id)
         VALUES ($1,'refund_succeeded',$2,'customer',$3,$4::jsonb,$5)`,
        [
          orderId,
          ctx.user ? "staff" : "system",
          `Refund ${formatIDR(amount)} ${fullyRefunded ? "(penuh)" : "(sebagian)"} selesai.`,
          JSON.stringify({ refundId, amount }),
          ctx.requestId,
        ],
      );
    }
  });
  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: "refund.settled",
    targetType: "refund",
    targetId: refundId,
    afterData: { amount, orderId },
    requestId: ctx.requestId,
  });
}

async function applyRefundEvent(
  ctx: RequestContext,
  providerRefundRef: string,
  status: "succeeded" | "failed",
): Promise<void> {
  const db = await getDb();
  const res = await db.query<{ id: string }>(`SELECT id FROM refunds WHERE provider_ref = $1`, [
    providerRefundRef,
  ]);
  const refundId = res.rows[0]?.id;
  if (!refundId) return;
  if (status === "succeeded")
    await settleRefund(ctx, String(refundId), { providerConfirmed: true });
  else
    await db.query("UPDATE refunds SET status='failed', updated_at=now() WHERE id=$1", [refundId]);
}

export async function listRefunds(filters: {
  status?: string;
  limit?: number;
}): Promise<RefundRow[]> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT r.*, o.order_number FROM refunds r JOIN orders o ON o.id = r.order_id
      WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at DESC LIMIT $2`,
    [filters.status ?? null, Math.min(100, filters.limit ?? 25)],
  );
  return res.rows.map(mapRefund);
}

export async function listWebhookEvents(limit = 25): Promise<
  Array<{
    id: string;
    provider: string;
    eventId: string;
    type: string;
    status: string;
    error: string | null;
    receivedAt: Date | null;
  }>
> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT id, provider_code, event_id, event_type, status, error_code, received_at FROM payment_webhook_events ORDER BY id DESC LIMIT $1`,
    [limit],
  );
  return res.rows.map((row) => ({
    id: text(row.id),
    provider: text(row.provider_code),
    eventId: text(row.event_id),
    type: text(row.event_type),
    status: text(row.status),
    error: optText(row.error_code),
    receivedAt: date(row.received_at),
  }));
}

/**
 * Konteks sandbox pembayaran lokal (halaman /simulasi-pembayaran): attempt + token lacak order
 * supaya tautan dev tetap memakai kemampuan akses yang sama dengan halaman konfirmasi pelanggan.
 */
export async function sandboxAttemptContext(
  attemptId: string,
): Promise<{ attempt: Awaited<ReturnType<typeof loadAttempt>>; trackingToken: string }> {
  const db = await getDb();
  const attempt = await loadAttempt(attemptId);
  const res = await db.query<Record<string, unknown>>(
    `SELECT tracking_token FROM orders WHERE id = $1`,
    [attempt.orderId],
  );
  return { attempt, trackingToken: text(res.rows[0]?.tracking_token, "") };
}

export function attemptSummaryFor(attempt: Awaited<ReturnType<typeof loadAttempt>>): {
  status: PaymentAttemptStatus;
  label: string;
} {
  return {
    status: attempt.status,
    label: `${paymentMethodLabel(attempt.methodCode)} · ${attempt.status}`,
  };
}
