import { getDb, text, num } from "@/platform/db";
import { addToCart, applyCoupon, saveCheckoutDraft } from "@/server/services/cart.service";
import { createOrder, type CreateOrderResult } from "@/server/services/checkout.service";
import { selectShipping } from "@/server/services/shipping.service";
import { generateIdempotencyKey } from "@/domain/ids";
import type { RequestContext } from "@/server/context";
import { hmacSha256 } from "@/platform/crypto-helpers";
import { env } from "@/platform/env";

export async function variantIdBySku(sku: string): Promise<string> {
  const db = await getDb();
  const res = await db.query<{ id: string }>(`SELECT id FROM product_variants WHERE sku = $1`, [
    sku,
  ]);
  const id = res.rows[0]?.id;
  if (!id) throw new Error(`varian ${sku} tidak ditemukan (seed belum jalan?)`);
  return String(id);
}

export async function balanceOf(sku: string, location = "MAIN") {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT on_hand, reserved, available FROM inventory_balances WHERE sku = $1 AND location_code = $2`,
    [sku, location],
  );
  const row = res.rows[0] ?? {};
  return { onHand: num(row.on_hand), reserved: num(row.reserved), available: num(row.available) };
}

export const DEMO_ADDRESS = {
  fullName: "Budi Santoso",
  phone: "081234567890",
  province: "DKI Jakarta",
  city: "Jakarta Timur",
  district: "Cipayung",
  postalCode: "13840",
  street: "Jl. Raya Bogor Km 18 No. 27, RT 04/RW 02",
  landmark: null,
};

export const DEMO_CONTACT = { email: "pembeli-uji@example.test", phone: "081234567890" };

export interface OrderFlowOptions {
  sku: string;
  quantity: number;
  coupon?: string;
  methodCode?: string;
  methodName?: string;
  contact?: { email: string; phone: string };
  idempotencyKey?: string;
}

/** Checkout lengkap lewat service (bukan SQL langsung) supaya jalur produksi yang diuji. */
export async function checkoutToOrder(
  ctx: RequestContext,
  options: OrderFlowOptions,
): Promise<CreateOrderResult> {
  const variantId = await variantIdBySku(options.sku);
  await addToCart(ctx, variantId, options.quantity);
  if (options.coupon) await applyCoupon(ctx, options.coupon);
  await saveCheckoutDraft(ctx, {
    contact: options.contact ?? DEMO_CONTACT,
    address: DEMO_ADDRESS,
    marketingConsent: false,
    payment: {
      methodCode: options.methodCode ?? "va_bca",
      methodName: options.methodName ?? "Transfer BCA Virtual Account",
    },
  });
  await selectShipping(ctx, { carrierCode: "any", serviceCode: "reg" });
  await saveCheckoutDraft(ctx, {
    termsAcceptedAt: new Date().toISOString(),
    policyVersion: "syarat-v1",
  });
  return createOrder(ctx, { idempotencyKey: options.idempotencyKey ?? generateIdempotencyKey() });
}

export async function attemptIdOf(orderId: string): Promise<string> {
  const db = await getDb();
  const res = await db.query<{ id: string }>(
    `SELECT id FROM payment_attempts WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("payment attempt tidak ditemukan");
  return String(id);
}

/** Bangun webhook mock yang ditanda-tangani seperti penyedia (raw body + HMAC). */
export async function signedWebhook(input: {
  orderNumber: string;
  attemptId: string;
  eventKind?: string;
  amount: number;
  eventId?: string;
}): Promise<{ rawBody: string; signature: string; eventId: string }> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT provider_ref FROM payment_attempts WHERE id = $1`,
    [input.attemptId],
  );
  const providerRef = text(res.rows[0]?.provider_ref, "MOCK-REF");
  const eventId = input.eventId ?? `evt-${Math.random().toString(36).slice(2, 10)}`;
  const body = JSON.stringify({
    event_id: eventId,
    event_type: input.eventKind ?? "payment.success",
    provider_ref: providerRef,
    order_number: input.orderNumber,
    amount: input.amount,
    currency: "IDR",
    occurred_at: new Date().toISOString(),
  });
  const signature = await hmacSha256(env.mockWebhookSecret, body);
  return { rawBody: body, signature, eventId };
}
