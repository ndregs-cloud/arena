import "server-only";
import { addMinutes } from "@/domain/clock";
import { AppError } from "@/domain/errors";
import { generateOrderNumber, generateTrackingToken } from "@/domain/ids";
import { assertShippingQuoteFresh, type PricingLine } from "@/domain/pricing";
import type { AddressSnapshot, OrderSnapshot } from "@/domain/orders";
import { zoneForProvince } from "@/domain/shipping";
import { ID_PHONE_RE } from "@/domain/validation";
import { writeAudit } from "@/platform/audit";
import { paymentProvider } from "@/platform/payment";
import { bool, date, getDb, jsonb, num, optNum, optText, text, type Tx } from "@/platform/db";
import { env } from "@/platform/env";
import { enqueueNotification } from "@/platform/notifications";
import { formatIDR } from "@/lib/format";
import type { RequestContext } from "@/server/context";
import { getCartSnapshot } from "@/server/services/cart.service";
import { redeemPromotion } from "@/server/services/promotion.service";
import { loadCurrentPolicyVersion } from "@/server/services/policy.service";

/**
 * Checkout & pembuatan order (Blueprint §6.1).
 * - Total dihitung ulang di server dari katalog (AT-03).
 * - Stok dikunci atomik dengan conditional update + reservation TTL (AT-02).
 * - Order dibuat ber-ID idempoten; retry tidak menghasilkan order ganda.
 * - Status awal SELALU pending_payment; tidak ada klaim "paid" dari sisi klien (AT-05).
 */

export interface CheckoutInput {
  idempotencyKey: string;
  /** skenario provider simulasi (opsional, hanya untuk sandbox lokal) */
  simScenario?: string;
}

export interface CreateOrderResult {
  orderNumber: string;
  orderId: string;
  trackingToken: string;
  totalAmount: number;
  status: string;
  paymentStatus: string;
  reused: boolean;
  attemptId: string;
  expiresAt: Date | null;
}

export interface CheckoutReadiness {
  ready: boolean;
  blockers: Array<{ step: "alamat" | "pengiriman" | "pembayaran" | "review"; message: string }>;
}

export async function evaluateCheckoutReadiness(ctx: RequestContext): Promise<CheckoutReadiness> {
  const blockers: CheckoutReadiness["blockers"] = [];
  const { view } = await getCartSnapshot(ctx);
  if (view.isEmpty) blockers.push({ step: "review", message: "Keranjang masih kosong." });
  const address = view.draft.address;
  if (!address || !address.street || !address.postalCode || !address.province) {
    blockers.push({ step: "alamat", message: "Lengkapi alamat pengiriman." });
  }
  if (!view.draft.shipping) {
    blockers.push({ step: "pengiriman", message: "Pilih metode pengiriman." });
  }
  if (!view.draft.payment) {
    blockers.push({ step: "pembayaran", message: "Pilih metode pembayaran." });
  }
  if (!view.draft.termsAcceptedAt || !view.draft.policyVersion) {
    blockers.push({
      step: "review",
      message: "Setujui syarat & kebijakan sebelum membuat pesanan.",
    });
  }
  // Kontak wajib bisa dihubungi: untuk tamu dari form, untuk akun boleh dari profil (nomor tetap needed bila kosong).
  const email = view.draft.contact?.email ?? ctx.user?.email ?? null;
  const phone = view.draft.contact?.phone ?? null;
  if (!email || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) {
    blockers.push({
      step: "review",
      message: "Isi email yang valid untuk status dan invoice pesanan.",
    });
  }
  if (!phone || !ID_PHONE_RE.test(phone.replace(/[\s().-]/g, ""))) {
    blockers.push({
      step: "review",
      message: "Isi nomor ponsel yang valid (dipakai kurir untuk konfirmasi pengiriman).",
    });
  }
  return { ready: blockers.length === 0, blockers };
}

export async function createOrder(
  ctx: RequestContext,
  input: CheckoutInput,
): Promise<CreateOrderResult> {
  const db = await getDb();

  // 1) Idempotensi: permintaan ulang dengan key sama mengembalikan order yang sama.
  const existing = await db.query<Record<string, unknown>>(
    `SELECT id, order_number, tracking_token, total_amount, status, payment_status, expires_at FROM orders WHERE idempotency_key = $1 LIMIT 1`,
    [input.idempotencyKey],
  );
  const existingRow = existing.rows[0];
  if (existingRow) {
    const attempt = await db.query<{ id: string }>(
      `SELECT id FROM payment_attempts WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [text(existingRow.id)],
    );
    return {
      orderNumber: text(existingRow.order_number),
      orderId: text(existingRow.id),
      trackingToken: text(existingRow.tracking_token),
      totalAmount: num(existingRow.total_amount),
      status: text(existingRow.status),
      paymentStatus: text(existingRow.payment_status),
      reused: true,
      attemptId: String(attempt.rows[0]?.id ?? ""),
      expiresAt: date(existingRow.expires_at),
    };
  }

  // 2) Muat cart + hitung ulang harga dari sumber kebenaran (bukan angka dari klien).
  const at = new Date();
  const { view, rows } = await getCartSnapshot(ctx, at);
  if (view.isEmpty) throw new AppError("CART_EMPTY", "Keranjang masih kosong.", { status: 422 });
  const readiness = await evaluateCheckoutReadiness(ctx);
  if (!readiness.ready) {
    throw new AppError("VALIDATION_FAILED", readiness.blockers[0]!.message, {
      status: 422,
      details: { blockers: readiness.blockers },
    });
  }

  const draft = view.draft;
  // Kontak sudah divalidasi readiness; nilai final dihitung di sini supaya snapshot order konsisten.
  const contactEmail = draft.contact?.email ?? ctx.user?.email ?? "";
  const contactPhone = draft.contact?.phone ?? ctx.user?.phone ?? "";
  assertShippingQuoteFresh(draft.shipping, at);

  const pricingLines: PricingLine[] = rows
    .filter((r) => !bool(r.saved_for_later))
    .map((r) => ({
      lineId: text(r.cart_item_id),
      variantId: text(r.variant_id),
      productId: text(r.product_id),
      sku: text(r.sku),
      name: text(r.product_name),
      variantLabel: text(r.variant_label),
      unitPriceAmount: num(r.price_amount),
      quantity: num(r.quantity),
      categoryId: text(r.category_id),
      maxQuantity: optNum(r.max_qty_per_order),
    }));
  const unavailable = rows.find(
    (r) =>
      !bool(r.saved_for_later) &&
      (bool(r.is_deleted) || !bool(r.is_active) || text(r.product_status) !== "published"),
  );
  if (unavailable) {
    throw new AppError(
      "PRODUCT_NOT_PUBLISHED",
      "Ada item yang sudah tidak tersedia. Perbarui keranjang Anda.",
      { status: 422 },
    );
  }

  const totals = view.totals;
  const address = draft.address!;
  const shippingAddress: AddressSnapshot = {
    fullName: address.fullName,
    phone: address.phone,
    province: address.province,
    city: address.city,
    district: address.district,
    postalCode: address.postalCode,
    street: address.street,
    landmark: address.landmark ?? null,
    zoneCode: zoneForProvince(address.province),
  };
  const policyVersion = draft.policyVersion ?? (await loadCurrentPolicyVersion("syarat"));

  // 3) Transaksi: order + item + reservasi stok atomik + kupon.
  const created = await db.transaction(async (tx) => {
    const orderNumber = generateOrderNumber(at);
    const trackingToken = generateTrackingToken();
    const expiresAt = addMinutes(at, env.paymentTimeoutMinutes);

    const orderInsert = await tx.query<{ id: string }>(
      `INSERT INTO orders (order_number, tracking_token, customer_id, email, phone, status, payment_status, fulfillment_status,
                           currency, subtotal_amount, discount_amount, shipping_amount, fee_amount, total_amount,
                           promotion_id, shipping_address, shipping_selection, policy_version, marketing_consent, cart_id, expires_at, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,'pending_payment','awaiting_payment','unfulfilled','IDR',$6,$7,$8,$9,($6::bigint - $7::bigint + $8::bigint + $9::bigint),$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        orderNumber,
        trackingToken,
        ctx.user?.id ?? null,
        contactEmail,
        contactPhone,
        totals.subtotalAmount,
        totals.discountAmount,
        totals.shippingAmount,
        totals.feeAmount,
        totals.promotionId,
        JSON.stringify(shippingAddress),
        JSON.stringify(draft.shipping),
        policyVersion,
        draft.marketingConsent,
        view.cartId,
        expiresAt.toISOString(),
        input.idempotencyKey,
      ],
    );
    const orderId = String(orderInsert.rows[0]?.id);

    const itemIds: Array<{
      orderItemId: string;
      sku: string;
      locationCode: string;
      quantity: number;
    }> = [];
    for (const line of rows.filter((r) => !bool(r.saved_for_later))) {
      const discountAllocated = num(totals.lineDiscounts[text(line.cart_item_id)] ?? 0);
      const itemInsert = await tx.query<{ id: string }>(
        `INSERT INTO order_items (order_id, product_id, variant_id, sku, name_snapshot, variant_label_snapshot,
                                  unit_price_amount, quantity, discount_allocated_amount, image_url, is_returnable)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [
          orderId,
          text(line.product_id),
          text(line.variant_id),
          text(line.sku),
          text(line.product_name),
          text(line.variant_label),
          num(line.price_amount),
          num(line.quantity),
          discountAllocated,
          optText(line.media_url),
          true,
        ],
      );
      const orderItemId = String(itemInsert.rows[0]?.id);
      const locationCode = env.defaultLocationCode;
      const quantity = num(line.quantity);
      const trackInventory = bool(line.track_inventory);

      if (trackInventory) {
        // Conditional update di dalam tx: dua pembeli tidak bisa mengambil stok yang sama (AT-02).
        const reserved = await tx.query<{ ok: unknown }>(
          `SELECT fn_reserve_stock($1,$2,$3) AS ok`,
          [locationCode, text(line.sku), quantity],
        );
        if (
          !reserved.rows[0] ||
          reserved.rows[0].ok === null ||
          reserved.rows[0].ok === undefined
        ) {
          throw new AppError(
            "STOCK_INSUFFICIENT",
            `Stok ${text(line.product_name)} tidak mencukupi. Jumlah tersedia: ${num(line.available)}.`,
            {
              status: 409,
              details: { availableQuantity: num(line.available), requested: quantity },
            },
          );
        }
        await tx.query(
          `INSERT INTO stock_reservations (location_code, sku, order_id, order_item_id, quantity, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            locationCode,
            text(line.sku),
            orderId,
            orderItemId,
            quantity,
            addMinutes(at, env.reservationTtlMinutes).toISOString(),
          ],
        );
        await tx.query(
          `INSERT INTO inventory_movements (location_code, sku, kind, quantity, balance_before, balance_after, reason_code, ref_type, ref_id, actor_id, request_id)
           SELECT $1,$2,'reserve',$3::integer, b.on_hand - b.reserved, b.on_hand - b.reserved - $3::integer, 'wrong_entry_fix', 'order', $4, $5, $6
             FROM inventory_balances b WHERE b.location_code=$1 AND b.sku=$2`,
          [locationCode, text(line.sku), quantity, orderId, ctx.user?.id ?? null, ctx.requestId],
        );
      }
      itemIds.push({ orderItemId, sku: text(line.sku), locationCode, quantity });
    }

    await tx.query(
      `INSERT INTO order_events (order_id, event_type, to_status, actor_kind, visibility, note, request_id)
       VALUES ($1,'order_created','pending_payment',$2,'customer',$3,$4)`,
      [
        orderId,
        ctx.user ? "customer" : "guest",
        `Order dibuat dari keranjang (${pricingLines.length} baris). Menunggu pembayaran.`,
        ctx.requestId,
      ],
    );

    if (totals.promotionId && totals.discountAmount > 0) {
      await tx.query("UPDATE carts SET promotion_id = NULL WHERE id = $1", [view.cartId]);
      await redeemPromotionViaTx(tx, {
        promotionId: totals.promotionId,
        orderId,
        customerId: ctx.user?.id ?? null,
        amount: totals.discountAmount,
      });
    }

    const attemptInsert = await tx.query<{ id: string }>(
      `INSERT INTO payment_attempts (order_id, provider_code, method_code, method_name, amount, currency, status, idempotency_key, is_simulated)
       VALUES ($1,$2,$3,$4,$5,'IDR','created',$6,$7) RETURNING id`,
      [
        orderId,
        paymentProvider().code,
        draft.payment!.methodCode,
        draft.payment!.methodName,
        totals.totalAmount,
        input.idempotencyKey,
        paymentProvider().isSimulated,
      ],
    );

    await tx.query("UPDATE carts SET status='converted', updated_at = now() WHERE id = $1", [
      view.cartId,
    ]);

    return {
      orderId,
      orderNumber,
      trackingToken,
      attemptId: String(attemptInsert.rows[0]?.id),
      expiresAt,
      itemIds,
    };
  });

  // 4) Efek samping non-finansial di luar tx: notifikasi & audit (retry aman via outbox).
  await enqueueNotification({
    kind: "order_created",
    to: contactEmail,
    orderId: created.orderId,
    vars: {
      orderNumber: created.orderNumber,
      customerName: address.fullName,
      statusNote: "menunggu pembayaran",
      total: formatIDR(totals.totalAmount),
      trackingUrl: `${env.appUrl}/lacak-pesanan/${created.trackingToken}`,
    },
  });
  await writeAudit({
    actorId: ctx.user?.id ?? null,
    actorEmail: ctx.user?.email ?? null,
    actorKind: ctx.user ? "customer" : "guest",
    action: "order.create",
    targetType: "order",
    targetId: created.orderId,
    afterData: {
      orderNumber: created.orderNumber,
      totalAmount: totals.totalAmount,
      lines: pricingLines.length,
      promotionId: totals.promotionId,
    },
    requestId: ctx.requestId,
  });

  return {
    orderNumber: created.orderNumber,
    orderId: created.orderId,
    trackingToken: created.trackingToken,
    totalAmount: totals.totalAmount,
    status: "pending_payment",
    paymentStatus: "awaiting_payment",
    reused: false,
    attemptId: created.attemptId,
    expiresAt: created.expiresAt,
  };
}

async function redeemPromotionViaTx(
  tx: { query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> },
  input: { promotionId: string; orderId: string; customerId: string | null; amount: number },
): Promise<void> {
  await tx.query(
    `INSERT INTO coupon_redemptions (promotion_id, order_id, customer_id, amount)
     VALUES ($1,$2,$3,$4) ON CONFLICT (promotion_id, order_id) DO NOTHING`,
    [input.promotionId, input.orderId, input.customerId, input.amount],
  );
  await tx.query(
    `UPDATE promotions SET used_count = used_count + 1, updated_at = now() WHERE id = $1 AND (usage_limit IS NULL OR used_count < usage_limit)`,
    [input.promotionId],
  );
}

/** Muat snapshot order (dipakai UI konfirmasi/pelacakan). */
export async function loadOrderSnapshot(
  orderId: string,
  executor?: Tx,
): Promise<OrderSnapshot | null> {
  const db = executor ?? (await getDb());
  const res = await db.query<Record<string, unknown>>(`SELECT * FROM orders WHERE id = $1`, [
    orderId,
  ]);
  const row = res.rows[0];
  if (!row) return null;
  const items = await db.query<Record<string, unknown>>(
    `SELECT * FROM order_items WHERE order_id = $1 ORDER BY id`,
    [orderId],
  );
  const events = await db.query<{ n: unknown }>(
    `SELECT count(*)::int AS n FROM order_events WHERE order_id=$1 AND visibility='internal'`,
    [orderId],
  );
  return mapOrderSnapshot(row, items.rows, num(events.rows[0]?.n));
}

export function mapOrderSnapshot(
  row: Record<string, unknown>,
  items: Record<string, unknown>[],
  internalNoteCount = 0,
): OrderSnapshot {
  const address = jsonb<AddressSnapshot>(row.shipping_address, {
    fullName: "",
    phone: "",
    province: "",
    city: "",
    district: "",
    postalCode: "",
    street: "",
    landmark: null,
    zoneCode: "JAWA",
  });
  const selection = jsonb<Record<string, unknown>>(row.shipping_selection, {});
  return {
    id: text(row.id),
    orderNumber: text(row.order_number),
    trackingToken: text(row.tracking_token),
    customerId: optText(row.customer_id),
    email: text(row.email),
    phone: text(row.phone),
    status: text(row.status) as OrderSnapshot["status"],
    paymentStatus: text(row.payment_status) as OrderSnapshot["paymentStatus"],
    fulfillmentStatus: text(row.fulfillment_status) as OrderSnapshot["fulfillmentStatus"],
    currency: "IDR",
    subtotalAmount: num(row.subtotal_amount),
    discountAmount: num(row.discount_amount),
    shippingAmount: num(row.shipping_amount),
    feeAmount: num(row.fee_amount),
    totalAmount: num(row.total_amount),
    refundedAmount: num(row.refunded_amount),
    promotionId: optText(row.promotion_id),
    shippingAddress: address,
    shippingSelection: {
      carrierCode: text(selection.carrierCode, "simulated"),
      serviceCode: text(selection.serviceCode),
      serviceName: text(selection.serviceName),
      estimateLabel: text(selection.estimateLabel),
    },
    lines: items.map((item) => ({
      orderItemId: text(item.id),
      productId: text(item.product_id),
      variantId: text(item.variant_id),
      sku: text(item.sku),
      nameSnapshot: text(item.name_snapshot),
      variantLabelSnapshot: text(item.variant_label_snapshot),
      unitPriceAmount: num(item.unit_price_amount),
      quantity: num(item.quantity),
      discountAllocatedAmount: num(item.discount_allocated_amount),
      lineTotalAmount: num(item.line_total_amount),
      imageUrl: optText(item.image_url),
      isReturnable: bool(item.is_returnable),
    })),
    policyVersion: text(row.policy_version, "1"),
    marketingConsent: bool(row.marketing_consent),
    campaignSource: optText(row.campaign_source),
    createdAt: date(row.created_at) ?? new Date(),
    updatedAt: date(row.updated_at) ?? new Date(),
    paidAt: date(row.paid_at),
    shippedAt: date(row.shipped_at),
    deliveredAt: date(row.delivered_at),
    cancelledAt: date(row.cancelled_at),
    cancelReason: optText(row.cancel_reason),
    internalNoteCount,
    customerNote: optText(row.customer_note),
  };
}

/** Kontak untuk tamu: disimpan di draft cart, divalidasi readiness, dan dipakai snapshot order. */
export function guestContactOf(draft: {
  contact: { email: string; phone: string } | null;
}): { email: string; phone: string } | null {
  return draft.contact;
}
