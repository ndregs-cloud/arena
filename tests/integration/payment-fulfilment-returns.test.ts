import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/domain/errors";
import { generateIdempotencyKey } from "@/domain/ids";
import { getDb, num, optNum, text } from "@/platform/db";
import { env } from "@/platform/env";
import {
  addTrackingEvent,
  createShipment,
  getCustomerOrder,
  getOrderByTrackingToken,
  syncOrderDeliveryFromShipment,
  transitionOrder,
} from "@/server/services/order.service";
import {
  approveRefund,
  expireUnpaidOrders,
  handleBrowserReturn,
  initiatePayment,
  ingestPaymentWebhook,
  requestRefund,
  settleRefund,
  submitRefund,
} from "@/server/services/payment.service";
import {
  checkReturnEligibility,
  createReturnRequest,
  decideReturn,
  inspectReturn,
  receiveReturnItems,
  resolveReturn,
} from "@/server/services/return.service";
import { closeDbForTests, seededDb } from "../helpers/db";
import {
  attemptIdOf,
  balanceOf,
  checkoutToOrder,
  signedWebhook,
  type OrderFlowOptions,
} from "../helpers/flow";
import { customerCtx, guestCtx, staffCtxForRole } from "../helpers/test-context";

/**
 * Pembayaran -> pemenuhan -> retur/refund memakai service nyata (adapter simulasi).
 * Fokus: AT-04 (idempotensi webhook), AT-05 (browser tidak boleh menandai lunas),
 * AT-07 (IDOR), AT-08 (cap refund + maker-checker), dan aturan "tracking tidak menurunkan status".
 */

beforeAll(async () => {
  await seededDb();
});

afterAll(async () => {
  await closeDbForTests();
});

interface OrderRow {
  status: string;
  payment_status: string;
  fulfillment_status: string;
  total_amount: number;
  refunded_amount: number;
  tracking_token: string;
  order_number: string;
}

async function orderRow(orderId: string): Promise<OrderRow> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT status, payment_status, fulfillment_status, total_amount, refunded_amount, tracking_token, order_number
       FROM orders WHERE id = $1`,
    [orderId],
  );
  const row = res.rows[0] ?? {};
  return {
    status: text(row.status),
    payment_status: text(row.payment_status),
    fulfillment_status: text(row.fulfillment_status),
    total_amount: num(row.total_amount),
    refunded_amount: num(row.refunded_amount),
    tracking_token: text(row.tracking_token),
    order_number: text(row.order_number),
  };
}

/** Bayar lewat webhook (jalur produksi), bukan UPDATE manual. */
async function payOrder(
  ctx: Awaited<ReturnType<typeof customerCtx>>,
  order: Awaited<ReturnType<typeof checkoutToOrder>>,
) {
  const attemptId = order.attemptId || (await attemptIdOf(order.orderId));
  await initiatePayment(ctx, attemptId);
  const hook = await signedWebhook({
    orderNumber: order.orderNumber,
    attemptId,
    amount: order.totalAmount,
  });
  const result = await ingestPaymentWebhook(
    hook.rawBody,
    hook.signature,
    guestCtx(`webhook-${order.orderNumber}`),
  );
  return { attemptId, hook, result };
}

async function paidOrder(label: string, options: OrderFlowOptions) {
  const ctx = await customerCtx(label);
  const order = await checkoutToOrder(ctx, options);
  const payment = await payOrder(ctx, order);
  return { ctx, order, ...payment };
}

/** Order sampai 'delivered' (prasyarat retur) lewat transisi legal, bukan UPDATE langsung. */
async function deliveredOrder(label: string, options: OrderFlowOptions) {
  const setup = await paidOrder(label, options);
  const op = await staffCtxForRole("order_operator");
  await transitionOrder(op, setup.order.orderId, "processing", { note: "Diproses (uji)" });
  const trackingNumber =
    `SIM-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const shipment = await createShipment(op, setup.order.orderId, {
    carrierCode: "simulasi",
    serviceCode: "reg",
    trackingNumber,
    packageCount: 1,
    note: "Paket uji integrasi",
    markShipped: true,
  });
  await addTrackingEvent(op, shipment.shipmentId, {
    status: "in_transit",
    location: "Hub Jakarta",
  });
  await addTrackingEvent(op, shipment.shipmentId, {
    status: "delivered",
    location: "Jakarta Timur",
  });
  await syncOrderDeliveryFromShipment(op, setup.order.orderId);
  return { ...setup, op, shipmentId: shipment.shipmentId, trackingNumber };
}

function randomSkuSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

describe("pembayaran & webhook (AT-04, AT-05)", () => {
  it("AT-04: event success mengesahkan pembayaran; event ganda tidak menghasilkan efek dua kali", async () => {
    const ctx = await customerCtx(`pay-dup-${randomSkuSuffix()}`);
    const order = await checkoutToOrder(ctx, { sku: "NS-KP-002-01", quantity: 2 });
    const before = await orderRow(order.orderId);
    expect(before.status).toBe("pending_payment");

    const { hook, result } = await payOrder(ctx, order);
    expect(result.outcome).toBe("processed");
    const paid = await orderRow(order.orderId);
    expect(paid.status).toBe("paid");
    expect(paid.payment_status).toBe("succeeded");

    const db = await getDb();
    const dup = await ingestPaymentWebhook(hook.rawBody, hook.signature, guestCtx("webhook-dup"));
    expect(dup.outcome).toBe("duplicate");
    const after = await orderRow(order.orderId);
    expect(after.status).toBe("paid");

    const events = await db.query<{ c: unknown }>(
      `SELECT count(*)::int AS c FROM payment_webhook_events WHERE provider_code='mock' AND event_id = $1`,
      [hook.eventId],
    );
    expect(num(events.rows[0]?.c)).toBe(1);
    const confirmations = await db.query<{ c: unknown }>(
      `SELECT count(*)::int AS c FROM order_events WHERE order_id = $1 AND event_type = 'payment_succeeded'`,
      [order.orderId],
    );
    expect(num(confirmations.rows[0]?.c)).toBe(1);
    // Pembayaran tidak boleh menggandakan nominal yang tercatat di order.
    expect(after.total_amount).toBe(before.total_amount);
  });

  it("webhook tanpa signature ditolak dan tidak mengubah status order", async () => {
    const ctx = await customerCtx(`pay-badsig-${randomSkuSuffix()}`);
    const order = await checkoutToOrder(ctx, { sku: "NS-KP-002-01", quantity: 1 });
    const attemptId = order.attemptId || (await attemptIdOf(order.orderId));
    await initiatePayment(ctx, attemptId);
    const hook = await signedWebhook({
      orderNumber: order.orderNumber,
      attemptId,
      amount: order.totalAmount,
    });

    await expect(
      ingestPaymentWebhook(hook.rawBody, null, guestCtx("webhook-no-sig")),
    ).rejects.toThrowError(AppError);
    await expect(
      ingestPaymentWebhook(hook.rawBody, "palsu".repeat(8), guestCtx("webhook-bad-sig")),
    ).rejects.toThrowError(/signature tidak valid/i);
    const row = await orderRow(order.orderId);
    expect(row.status).toBe("pending_payment");
    expect(row.payment_status).not.toBe("succeeded");
  });

  it("nominal event tidak cocok -> needs_review, bukan dipaksa selesai", async () => {
    const ctx = await customerCtx(`pay-mismatch-${randomSkuSuffix()}`);
    const order = await checkoutToOrder(ctx, { sku: "NS-KP-002-01", quantity: 1 });
    const attemptId = order.attemptId || (await attemptIdOf(order.orderId));
    await initiatePayment(ctx, attemptId);
    const hook = await signedWebhook({
      orderNumber: order.orderNumber,
      attemptId,
      amount: order.totalAmount + 1_000,
    });
    const result = await ingestPaymentWebhook(
      hook.rawBody,
      hook.signature,
      guestCtx("webhook-mismatch"),
    );
    expect(result.outcome).toBe("needs_review");
    const row = await orderRow(order.orderId);
    expect(row.payment_status).not.toBe("succeeded");
    const db = await getDb();
    const flagged = await db.query<{ status: unknown }>(
      `SELECT status FROM payment_webhook_events WHERE event_id = $1`,
      [hook.eventId],
    );
    expect(text(flagged.rows[0]?.status)).toBe("needs_review");
  });

  it("AT-05: halaman kembali dari browser tidak boleh menandai lunas", async () => {
    const ctx = await customerCtx(`browser-return-${randomSkuSuffix()}`);
    const order = await checkoutToOrder(ctx, { sku: "NS-KP-002-01", quantity: 1 });
    const attemptId = order.attemptId || (await attemptIdOf(order.orderId));
    const initiated = await initiatePayment(ctx, attemptId, { simScenario: "pending" });
    expect(initiated.isSimulated).toBe(true);

    const returned = await handleBrowserReturn(ctx, attemptId);
    expect(returned.status).not.toBe("succeeded");
    expect(returned.orderStatus).not.toBe("paid");
    expect(returned.message).toMatch(/menunggu|belum|verifikasi|diproses/i);
    const row = await orderRow(order.orderId);
    expect(row.payment_status).not.toBe("succeeded");
    expect(row.status).toBe("pending_payment");
  });

  it("batas waktu pembayaran habis: order dibatalkan dan reservasi dilepas", async () => {
    const label = `expire-${randomSkuSuffix()}`;
    const ctx = await customerCtx(label);
    const sku = "NS-KB-001-03";
    const before = await balanceOf(sku);
    const order = await checkoutToOrder(ctx, {
      sku,
      quantity: 2,
      idempotencyKey: generateIdempotencyKey(),
    });
    const during = await balanceOf(sku);
    expect(during.reserved).toBe(before.reserved + 2);

    const db = await getDb();
    await db.query(`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      order.orderId,
    ]);
    const summary = await expireUnpaidOrders();
    expect(summary.orders).toBeGreaterThanOrEqual(1);

    const row = await orderRow(order.orderId);
    expect(row.status).toBe("cancelled");
    expect(row.payment_status).toBe("expired");
    const after = await balanceOf(sku);
    expect(after.reserved).toBe(before.reserved);
    expect(after.available).toBe(before.available);
  });
});

describe("pemenuhan, lacak, dan RBAC (Blueprint §9, §10.2)", () => {
  it("status order tidak boleh melompat dari paid ke delivered", async () => {
    const { order, op } = await deliveredOrder("jump-1", { sku: "NS-KP-002-01", quantity: 1 });
    const ctx = await customerCtx("jump-1");
    const paidAgain = await checkoutToOrder(ctx, { sku: "NS-KP-002-01", quantity: 1 });
    await payOrder(ctx, paidAgain);
    await expect(
      transitionOrder(op, paidAgain.orderId, "delivered", { reason: "meloncat status" }),
    ).rejects.toThrowError(AppError);
    expect((await orderRow(order.orderId)).status).toBe("delivered");
  });

  it("event tracking tidak menurunkan status; urutan dipertahankan", async () => {
    const { op, shipmentId, order } = await deliveredOrder("tracking-order", {
      sku: "NS-KP-002-01",
      quantity: 1,
    });
    const db = await getDb();
    const shipmentRow = await db.query<Record<string, unknown>>(
      `SELECT status FROM shipments WHERE id = $1`,
      [shipmentId],
    );
    expect(text(shipmentRow.rows[0]?.status)).toBe("delivered");

    const stale = await addTrackingEvent(op, shipmentId, {
      status: "in_transit",
      location: "Data lama",
    });
    expect(stale.applied).toBe(false);
    expect(stale.message).toMatch(/mengabaikan|tidak menurunkan/i);
    const after = await db.query<Record<string, unknown>>(
      `SELECT status FROM shipments WHERE id = $1`,
      [shipmentId],
    );
    expect(text(after.rows[0]?.status)).toBe("delivered");
    expect((await orderRow(order.orderId)).fulfillment_status).toBe("delivered");
  });

  it("AT-07: pesanan tidak bisa dibaca akun lain; tautan lacak hanya memberi data ter-mask", async () => {
    const { ctx, order, op } = await deliveredOrder("idor", { sku: "NS-KP-002-01", quantity: 1 });
    const other = await customerCtx("idor-other");
    await expect(getCustomerOrder(other, order.orderNumber)).rejects.toThrowError(AppError);

    const mine = await getCustomerOrder(ctx, order.orderNumber);
    expect(mine.orderNumber).toBe(order.orderNumber);

    const row = await orderRow(order.orderId);
    const tracked = await getOrderByTrackingToken(row.tracking_token);
    expect(tracked).not.toBeNull();
    expect(tracked?.maskedEmail).toMatch(/\*\*/);
    expect(tracked?.maskedPhone).toMatch(/\*\*/);
    expect(tracked?.shipments.length).toBeGreaterThanOrEqual(1);
    expect(await getOrderByTrackingToken(`token-palsu-${randomSkuSuffix()}`)).toBeNull();

    // Staf tanpa izin proses tidak boleh mengubah status.
    const cs = await staffCtxForRole("customer_support");
    await expect(
      transitionOrder(cs, order.orderId, "on_hold", { reason: "coba" }),
    ).rejects.toThrowError(/izin|akses|permission/i);
    expect(cs.permissions.has("order.process")).toBe(false);
    expect(op.permissions.has("tracking.manage")).toBe(true);
  });
});

describe("retur & refund (AT-08)", () => {
  it("alur retur lengkap: kelayakan, RBAC persetujuan, penerimaan, inspeksi, refund proporsional", async () => {
    const { ctx, order, op } = await deliveredOrder("return-flow", {
      sku: "NS-HP-001-01",
      quantity: 3,
      coupon: "HERO10",
    });
    const eligibility = await checkReturnEligibility(ctx, order.orderNumber);
    expect(eligibility.eligibility.eligible).toBe(true);
    const line = eligibility.order.lines[0]!;

    // Satu dari tiga item: nilai retur = (total baris - alokasi diskon) x 1/3.
    const expected = Math.round(
      (line.lineTotalAmount - line.discountAllocatedAmount) / line.quantity,
    );
    const created = await createReturnRequest(ctx, {
      orderNumber: order.orderNumber,
      // Alasan tanpa kebijakan pengembalian ongkir: nilai retur = alokasi baris saja (AT-08),
      // supaya bisa dibandingkan persis dengan total baris dikurangi porsi diskon kupon.
      reasonCode: "changed_mind",
      description: "Berubah pikiran, minta pengembalian dana.",
      resolution: "refund",
      lines: [{ orderItemId: line.orderItemId, quantity: 1 }],
    });
    expect(created.reference).toMatch(/^RET-\d{8}-[A-Z0-9]{6}$/);

    const db = await getDb();
    const returnRes = await db.query<Record<string, unknown>>(
      `SELECT id, status, requested_amount FROM returns WHERE reference = $1`,
      [created.reference],
    );
    const returnId = text(returnRes.rows[0]?.id);
    expect(num(returnRes.rows[0]?.requested_amount)).toBe(expected);
    expect(text(returnRes.rows[0]?.status)).toBe("requested");

    // Retur tidak boleh disetujui role yang hanya boleh mengelola (customer_support).
    const cs = await staffCtxForRole("customer_support");
    await expect(decideReturn(cs, returnId, "approved", "setuju")).rejects.toThrowError(
      /izin|akses|approval/i,
    );

    const manager = await staffCtxForRole("manager");
    const approved = await decideReturn(
      manager,
      returnId,
      "approved",
      "Barang sesuai laporan, disetujui.",
    );
    expect(approved.message).toMatch(/disetujui/i);
    const statusAfterDecision = await db.query<Record<string, unknown>>(
      `SELECT status, approved_amount FROM returns WHERE id=$1`,
      [returnId],
    );
    expect(text(statusAfterDecision.rows[0]?.status)).toBe("awaiting_return");
    expect(num(statusAfterDecision.rows[0]?.approved_amount)).toBe(expected);

    await receiveReturnItems(op, returnId, [{ orderItemId: line.orderItemId, quantity: 1 }]);
    const inspection = await inspectReturn(op, returnId, {
      passed: true,
      note: "Kondisi baik, layak jual",
    });
    expect(inspection.restocked).toBe(1);

    const resolved = await resolveReturn(manager, returnId, {
      resolution: "refund",
      note: "Refund sesuai nilai disetujui",
    });
    // Nilai retur di atas ambang auto-approve -> ledger refund dibuat 'requested' dan menunggu
    // penyetuju kedua; resolveReturn TIDAK boleh menandai dana sudah kembali.
    expect(resolved.message).toMatch(/menunggu persetujuan/i);

    const ledger = await db.query<Record<string, unknown>>(
      `SELECT r.id, r.status, r.amount, o.refunded_amount, o.payment_status
         FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.return_id = $1`,
      [returnId],
    );
    const refundId = text(ledger.rows[0]?.id);
    expect(num(ledger.rows[0]?.amount)).toBe(expected);
    expect(text(ledger.rows[0]?.status)).toBe("requested");
    expect(num(ledger.rows[0]?.refunded_amount)).toBe(0);

    // Maker-checker: penyetuju berbeda dari pengaju, lalu dikirim ke penyedia (simulasi) dan ditutup.
    const finance = await staffCtxForRole("finance");
    await approveRefund(finance, refundId, "approved", "Sesuai hasil inspeksi gudang.");
    await submitRefund(manager, refundId);
    await settleRefund(finance, refundId, { providerConfirmed: true });

    const after = await db.query<Record<string, unknown>>(
      `SELECT r.status, o.refunded_amount, o.payment_status FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.id = $1`,
      [refundId],
    );
    expect(text(after.rows[0]?.status)).toBe("succeeded");
    expect(num(after.rows[0]?.refunded_amount)).toBe(expected);
    expect(["partially_refunded", "refunded"]).toContain(text(after.rows[0]?.payment_status));

    // Stok kembali tersedia karena barang layak jual.
    const balance = await balanceOf(text(line.sku));
    expect(balance.reserved).toBeLessThanOrEqual(balance.onHand);

    // Baris yang sama tidak boleh diretur dua kali penuh.
    await expect(
      createReturnRequest(ctx, {
        orderNumber: order.orderNumber,
        reasonCode: "changed_mind",
        description: "Coba retur ulang baris yang sama.",
        resolution: "refund",
        lines: [{ orderItemId: line.orderItemId, quantity: line.quantity }],
      }),
    ).rejects.toThrowError(AppError);
  });

  it("refund penuh: cap refundable, maker-checker, dan penyelesaian lewat simulasi provider", async () => {
    const { order } = await paidOrder("refund-full", { sku: "NS-HP-001-01", quantity: 3 });
    const row = await orderRow(order.orderId);
    const db = await getDb();
    const manager = await staffCtxForRole("manager");
    const finance = await staffCtxForRole("finance");

    await expect(
      requestRefund(manager, {
        orderId: order.orderId,
        amount: row.total_amount + 1,
        reason: "Melebihi nominal bayar",
      }),
    ).rejects.toThrowError(/melebihi|tidak dapat dikembalikan|refundable/i);

    const requested = await requestRefund(manager, {
      orderId: order.orderId,
      amount: row.total_amount,
      reason: "Pembatalan setelah pembayaran (uji integrasi)",
    });
    // Di atas ambang auto-approve -> wajib penyetuju kedua.
    expect(requested.awaitingApproval).toBe(true);
    expect(requested.refund.status).toBe("requested");
    expect(requested.message).toMatch(/menunggu persetujuan/i);

    await expect(
      approveRefund(manager, requested.refund.id, "approved", "saya juga yang mengaju"),
    ).rejects.toThrowError(/berbeda dari pengaju|pemisahan tugas/i);

    const approved = await approveRefund(
      finance,
      requested.refund.id,
      "approved",
      "Dana dikembalikan penuh.",
    );
    expect(approved.status).toBe("approved");
    const approverRow = await db.query<Record<string, unknown>>(
      `SELECT requested_by, approved_by FROM refunds WHERE id=$1`,
      [requested.refund.id],
    );
    expect(text(approverRow.rows[0]?.approved_by)).not.toBe(
      text(approverRow.rows[0]?.requested_by),
    );

    const submitted = await submitRefund(manager, requested.refund.id);
    expect(submitted.status).toBe("pending");
    expect(submitted.providerRefundRef).toMatch(/^SIM-REF-/);

    await settleRefund(finance, requested.refund.id, { providerConfirmed: true });
    const settled = await orderRow(order.orderId);
    expect(settled.refunded_amount).toBe(row.total_amount);
    expect(settled.payment_status).toBe("refunded");

    await expect(
      requestRefund(manager, { orderId: order.orderId, amount: 1, reason: "sudah penuh direfund" }),
    ).rejects.toThrowError(/melebihi|tidak dapat dikembalikan|habis/i);
  });

  it("refund di bawah ambang diproses otomatis tanpa mengklaim penyetuju manusia", async () => {
    const { order } = await paidOrder("refund-small", { sku: "NS-KP-002-01", quantity: 1 });
    const row = await orderRow(order.orderId);
    const amount = Math.max(1, Math.min(env.refundAutoApproveLimit - 1, row.total_amount));
    const manager = await staffCtxForRole("manager");
    const requested = await requestRefund(manager, {
      orderId: order.orderId,
      amount,
      reason: "Barang dibatalkan sebelum dikirim",
    });
    expect(requested.awaitingApproval).toBe(false);
    expect(requested.refund.status).toBe("approved");

    const db = await getDb();
    const row2 = await db.query<Record<string, unknown>>(
      `SELECT requested_by, approved_by, status FROM refunds WHERE id=$1`,
      [requested.refund.id],
    );
    expect(optNum(row2.rows[0]?.approved_by ?? null)).toBeNull();
    expect(text(row2.rows[0]?.status)).toBe("approved");

    await submitRefund(manager, requested.refund.id);
    await settleRefund(manager, requested.refund.id); // provider simulasi: konfirmasi tidak wajib
    const after = await orderRow(order.orderId);
    expect(after.refunded_amount).toBe(amount);
    const refundStatus = await db.query<Record<string, unknown>>(
      `SELECT status FROM refunds WHERE id=$1`,
      [requested.refund.id],
    );
    expect(text(refundStatus.rows[0]?.status)).toBe("succeeded");
  });

  it("pembatalan otomatis hanya selama paket belum keluar gudang", async () => {
    const ctx = await customerCtx(`cancel-open-${randomSkuSuffix()}`);
    const open = await checkoutToOrder(ctx, { sku: "NS-KP-002-01", quantity: 1 });
    const manager = await staffCtxForRole("manager");
    const cancelled = await transitionOrder(manager, open.orderId, "cancelled", {
      reason: "Permintaan pelanggan (uji)",
    });
    expect(cancelled.order.status).toBe("cancelled");

    const { order } = await deliveredOrder("cancel-shipped", { sku: "NS-KP-002-01", quantity: 1 });
    await expect(
      transitionOrder(manager, order.orderId, "cancelled", { reason: "sudah delivered" }),
    ).rejects.toThrowError(AppError);
  });
});
