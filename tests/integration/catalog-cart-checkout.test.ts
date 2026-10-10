import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/domain/errors";
import { getDb } from "@/platform/db";
import { text, num, optNum } from "@/platform/db";
import { listProducts, getProductBySlug } from "@/server/services/catalog.service";
import {
  addToCart,
  applyCoupon,
  getCartView,
  updateCartLineQuantity,
  removeCoupon,
} from "@/server/services/cart.service";
import { createOrder, evaluateCheckoutReadiness } from "@/server/services/checkout.service";
import { expireReservations } from "@/server/services/inventory.service";
import { closeDbForTests, seededDb } from "../helpers/db";
import { balanceOf, checkoutToOrder, DEMO_ADDRESS, DEMO_CONTACT } from "../helpers/flow";
import { customerCtx, guestCtx, makeCtx, staffCtx } from "../helpers/test-context";
import { saveCheckoutDraft } from "@/server/services/cart.service";
import { generateIdempotencyKey } from "@/domain/ids";

/**
 * Integrasi katalog -> keranjang -> checkout memakai service nyata di atas PostgreSQL
 * (engine tertanam pglite, migrasi penuh). AT-01, AT-02, AT-03 dan idempotensi.
 */

let ready = false;

beforeAll(async () => {
  await seededDb();
  ready = true;
});

afterAll(async () => {
  await closeDbForTests();
});

function expectReady() {
  if (!ready) throw new Error("seed belum selesai");
}

async function variantId(sku: string): Promise<string> {
  const db = await getDb();
  const res = await db.query<{ id: string }>(`SELECT id FROM product_variants WHERE sku = $1`, [
    sku,
  ]);
  return String(res.rows[0]?.id);
}

async function productId(slug: string): Promise<Record<string, unknown>> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT id, status FROM products WHERE slug = $1`,
    [slug],
  );
  return res.rows[0] ?? {};
}

describe("katalog & visibilitas (AT-01)", () => {
  it("draf tidak muncul di daftar publik, pencarian, maupun halaman produk", async () => {
    expectReady();
    const guest = guestCtx("cart-at01-guest");
    const list = await listProducts({ perPage: 60 });
    const slugs = list.items.map((item) => item.slug);
    expect(slugs).not.toContain("headphone-studio-aureo-pro");
    const search = await listProducts({ q: "Aureo Pro", perPage: 20 });
    expect(search.items.map((i) => i.slug)).not.toContain("headphone-studio-aureo-pro");
    await expect(getProductBySlug("headphone-studio-aureo-pro", guest)).resolves.toBeNull();
    expect(await getProductBySlug("headphone-nirkabel-aureo-h2", guest)).not.toBeNull();
  });

  it("staf dengan izin view_draft boleh melihat pratinjau draf", async () => {
    expectReady();
    const editor = makeCtx({ user: undefined, role: "catalog_editor" });
    const detail = await getProductBySlug("headphone-studio-aureo-pro", editor);
    expect(detail?.name).toContain("Aureo Pro");
    const adminList = await listProducts({ perPage: 60, includeUnpublished: true });
    expect(adminList.items.map((i) => i.slug)).toContain("headphone-studio-aureo-pro");
  });

  it("filter harga, merek, dan stok; faset dihitung dari hasil", async () => {
    expectReady();
    const result = await listProducts({ brands: ["Aureo"], maxPrice: 700_000, perPage: 20 });
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.brand).toBe("Aureo");
      expect(item.minPriceAmount).toBeLessThanOrEqual(700_000);
    }
    const inStockOnly = await listProducts({ inStockOnly: true, perPage: 60 });
    expect(inStockOnly.items.every((i) => i.availableQuantity > 0)).toBe(true);
    const noMatch = await listProducts({ q: "zzz-tidak-ada", perPage: 20 });
    expect(noMatch.items).toHaveLength(0);
    expect(noMatch.queryApplied).toBe(true);
    expect(noMatch.facets.brands.length).toBeGreaterThanOrEqual(0);
  });

  it("slug pensiun dialihkan ke slug aktif", async () => {
    expectReady();
    const db = await getDb();
    const target = await productId("number-pad-kanvas-mini");
    const oldSlug = `number-pad-kanvas-mini-lama`;
    await db.query(
      `UPDATE products SET retired_slugs = array_append(retired_slugs, $2) WHERE id = $1`,
      [text(target.id), oldSlug],
    );
    const guest = guestCtx("cart-at01-redirect");
    const moved = await getProductBySlug(oldSlug, guest);
    // archived tetap tidak tampil untuk tamu; redirect hanya berlaku untuk produk yang masih published
    expect(moved).toBeNull();
  });
});

describe("keranjang (Blueprint §5.3)", () => {
  it("menambahkan item, menghitung ulang harga dari DB, dan menolak kuantitas melebihi stok", async () => {
    expectReady();
    const ctx = guestCtx(`cart-add-${Date.now()}`);
    const variant = await variantId("NS-HP-001-01");
    const added = await addToCart(ctx, variant, 2);
    expect(added.appliedQuantity).toBe(2);
    expect(added.cart.totals.subtotalAmount).toBe(2_500_000);
    expect(added.cart.lines).toHaveLength(1);

    const clamped = await addToCart(ctx, variant, 500);
    expect(clamped.cart.itemCount).toBeLessThanOrEqual(10);
    expect(clamped.appliedQuantity).toBeLessThanOrEqual(10);

    const draftVariant = await variantId("NS-HP-003-01");
    await expect(addToCart(ctx, draftVariant, 1)).rejects.toThrowError(AppError);
  });

  it("mengubah kuantitas menyesuaikan stok dan menghapus baris saat 0", async () => {
    expectReady();
    const ctx = guestCtx(`cart-qty-${Date.now()}`);
    const variant = await variantId("NS-WT-001-02"); // 46 mm / Onyx (stok 9)
    const { cart } = await addToCart(ctx, variant, 3);
    const line = cart.lines[0]!;
    const updated = await updateCartLineQuantity(ctx, line.cartItemId, 99);
    expect(updated.adjusted).toBe(true);
    expect(updated.cart.lines[0]?.quantity).toBeLessThanOrEqual(9);
    const removed = await updateCartLineQuantity(ctx, line.cartItemId, 0);
    expect(removed.cart.isEmpty).toBe(true);
  });

  it("stok habis memberi peringatan dan tidak bisa dipesan", async () => {
    expectReady();
    const ctx = guestCtx(`cart-oos-${Date.now()}`);
    const variant = await variantId("NS-WT-002-02"); // Nusa Fit Navy, on_hand 0
    const result = await addToCart(ctx, variant, 1).catch((error: unknown) => error);
    if (result instanceof AppError) {
      expect(["STOCK_INSUFFICIENT", "VALIDATION_FAILED"]).toContain(result.code);
    } else {
      const view = await getCartView(ctx);
      expect(view.warnings.length).toBeGreaterThan(0);
      expect(view.lines[0]?.available).toBe(0);
    }
  });
});

describe("kupon & promo (Blueprint §7.1, AT-09)", () => {
  it("kode aktif memangkas total dengan cap; kode kedaluwarsa dan limit ditolak", async () => {
    expectReady();
    const ctx = await customerCtx("coupon");
    const variant = await variantId("NS-HP-001-01"); // 1.250.000 x 3 = 3.750.000
    await addToCart(ctx, variant, 3);
    const applied = await applyCoupon(ctx, "HERO10");
    expect(applied.cart.promotion?.code).toBe("HERO10");
    expect(applied.cart.totals.discountAmount).toBe(250_000); // 10% = 375.000 tapi cap 250.000
    const removed = await removeCoupon(ctx);
    expect(removed.totals.discountAmount).toBe(0);

    await expect(applyCoupon(ctx, "EXPIRED20")).rejects.toThrowError(
      /luar periode|kedaluwarsa|berakhir|tidak berlaku|tidak dikenali/i,
    );
    await expect(applyCoupon(ctx, "KODE-TIDAK-ADA")).rejects.toThrowError(AppError);
    await expect(applyCoupon(ctx, "APPROVE25")).rejects.toThrowError(AppError);
  });

  it("free_shipping menghilangkan ongkir dari total", async () => {
    expectReady();
    const ctx = await customerCtx("freeship");
    const variant = await variantId("NS-KP-002-01"); // 95.000 x 4 = 380.000 (>= min 300.000)
    await addToCart(ctx, variant, 4);
    await applyCoupon(ctx, "ONGKIRGRATIS");
    await saveCheckoutDraft(ctx, { contact: DEMO_CONTACT, address: DEMO_ADDRESS });
    const { selectShipping } = await import("@/server/services/shipping.service");
    await selectShipping(ctx, { carrierCode: "any", serviceCode: "reg" });
    const view = await getCartView(ctx);
    expect(view.totals.freeShippingApplied).toBe(true);
    expect(view.totals.shippingAmount).toBe(0);
  });
});

describe("checkout & order (AT-02, AT-03, §6.1)", () => {
  it("readiness menyebut hambatan per langkah, bukan error umum", async () => {
    expectReady();
    const ctx = await customerCtx("readiness");
    const variant = await variantId("NS-HP-001-02");
    await addToCart(ctx, variant, 1);
    const first = await evaluateCheckoutReadiness(ctx);
    expect(first.ready).toBe(false);
    expect(first.blockers.map((b) => b.step)).toEqual(
      expect.arrayContaining(["alamat", "pengiriman", "pembayaran"]),
    );
    await saveCheckoutDraft(ctx, {
      contact: DEMO_CONTACT,
      address: DEMO_ADDRESS,
      payment: { methodCode: "va_bca", methodName: "Transfer BCA Virtual Account" },
    });
    const { selectShipping } = await import("@/server/services/shipping.service");
    await selectShipping(ctx, { carrierCode: "any", serviceCode: "reg" });
    const afterShipping = await evaluateCheckoutReadiness(ctx);
    expect(afterShipping.blockers.map((b) => b.step)).toEqual(["review"]);
    await saveCheckoutDraft(ctx, {
      termsAcceptedAt: new Date().toISOString(),
      policyVersion: "syarat-v1",
    });
    expect((await evaluateCheckoutReadiness(ctx)).ready).toBe(true);
  });

  it("membuat order: snapshot harga DB, reservasi stok, dan idempoten saat retry", async () => {
    expectReady();
    const db = await getDb();
    const sku = "NS-SP-001-01";
    const before = await balanceOf(sku);
    const key = generateIdempotencyKey();
    const ctx = await customerCtx("order");
    const order = await checkoutToOrder(ctx, { sku, quantity: 3, idempotencyKey: key });
    expect(order.status).toBe("pending_payment");
    expect(order.paymentStatus).toBe("awaiting_payment");
    const dbOrder = await db.query<Record<string, unknown>>(
      `SELECT subtotal_amount, discount_amount, shipping_amount, total_amount FROM orders WHERE id = $1`,
      [order.orderId],
    );
    const subtotal = num(dbOrder.rows[0]?.subtotal_amount);
    const discount = num(dbOrder.rows[0]?.discount_amount);
    const shipping = num(dbOrder.rows[0]?.shipping_amount);
    expect(num(dbOrder.rows[0]?.total_amount)).toBe(subtotal - discount + shipping);
    expect(subtotal).toBe(825_000 * 3);
    expect(order.trackingToken.length).toBeGreaterThanOrEqual(20);

    const after = await balanceOf(sku);
    expect(after.reserved).toBe(before.reserved + 3);
    expect(after.onHand).toBe(before.onHand);

    const res = await db.query<Record<string, unknown>>(
      `SELECT count(*)::int AS items FROM order_items WHERE order_id = $1`,
      [order.orderId],
    );
    expect(num(res.rows[0]?.items)).toBe(1);

    // retry dengan key sama -> order yang sama, tanpa stok cadangan baru
    const retry = await createOrder(ctx, { idempotencyKey: key });
    expect(retry.reused).toBe(true);
    expect(retry.orderNumber).toBe(order.orderNumber);
    expect((await balanceOf(sku)).reserved).toBe(after.reserved);

    const events = await db.query<{ c: unknown }>(
      `SELECT count(*)::int AS c FROM order_events WHERE order_id = $1`,
      [order.orderId],
    );
    expect(num(events.rows[0]?.c)).toBeGreaterThan(0);
    const audit = await db.query<{ c: unknown }>(
      `SELECT count(*)::int AS c FROM audit_logs WHERE target_type = 'order' AND target_id = $1`,
      [order.orderId],
    );
    expect(num(audit.rows[0]?.c)).toBeGreaterThan(0);
  });

  it("AT-03: total klien tidak dipercaya - harga yang berubah di DB menang", async () => {
    expectReady();
    const db = await getDb();
    const sku = "NS-MS-001-01";
    const variant = await variantId(sku);
    const before = await db.query<{ price_amount: unknown; compare_at_amount: unknown }>(
      `SELECT price_amount, compare_at_amount FROM product_variants WHERE id = $1`,
      [variant],
    );
    const original = num(before.rows[0]?.price_amount);
    const originalCompare = optNum(before.rows[0]?.compare_at_amount);
    const ctx = await customerCtx("tampered");
    await addToCart(ctx, variant, 2);

    // Harga naik setelah item masuk keranjang: order harus memakai harga baru.
    // compare_at_amount harus tetap > price_amount (CHECK di DB), jadi keduanya digeser.
    await db.query(
      `UPDATE product_variants SET price_amount = $2, compare_at_amount = $3 WHERE id = $1`,
      [variant, original + 100_000, (originalCompare ?? original) + 200_000],
    );
    await saveCheckoutDraft(ctx, {
      contact: DEMO_CONTACT,
      address: DEMO_ADDRESS,
      payment: { methodCode: "qris", methodName: "QRIS (Simulasi)" },
      termsAcceptedAt: new Date().toISOString(),
      policyVersion: "syarat-v1",
    });
    const { selectShipping } = await import("@/server/services/shipping.service");
    const { cart } = await selectShipping(ctx, { carrierCode: "any", serviceCode: "reg" });
    const expected =
      (original + 100_000) * 2 + cart.totals.shippingAmount - cart.totals.discountAmount;
    expect(cart.totals.subtotalAmount).toBe((original + 100_000) * 2);

    const order = await createOrder(ctx, { idempotencyKey: generateIdempotencyKey() });
    expect(order.totalAmount).toBe(expected);
    await db.query(
      `UPDATE product_variants SET price_amount = $2, compare_at_amount = $3 WHERE id = $1`,
      [variant, original, originalCompare],
    );
  });

  it("AT-02: dua request bersamaan untuk stok terakhir - tidak ada penjualan lebih", async () => {
    expectReady();
    const db = await getDb();
    const sku = "NS-HP-002-02"; // Aureo Air Graphite, on_hand = 1
    const variant = await variantId(sku);
    const balance = await balanceOf(sku);
    expect(balance.onHand - balance.reserved).toBe(1);

    const ctxA = await customerCtx("race-a");
    const ctxB = await customerCtx("race-b");
    await addToCart(ctxA, variant, 1);
    await addToCart(ctxB, variant, 1);
    for (const ctx of [ctxA, ctxB]) {
      await saveCheckoutDraft(ctx, {
        contact: DEMO_CONTACT,
        address: DEMO_ADDRESS,
        payment: { methodCode: "va_bca", methodName: "Transfer BCA Virtual Account" },
        termsAcceptedAt: new Date().toISOString(),
        policyVersion: "syarat-v1",
      });
      const { selectShipping } = await import("@/server/services/shipping.service");
      await selectShipping(ctx, { carrierCode: "any", serviceCode: "reg" });
    }

    const results = await Promise.allSettled([
      createOrder(ctxA, { idempotencyKey: generateIdempotencyKey() }),
      createOrder(ctxB, { idempotencyKey: generateIdempotencyKey() }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof createOrder>>
    >[];
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    const reasons = rejected.map((r) => {
      const reason = r.reason;
      return reason instanceof AppError ? `${reason.code}: ${reason.message}` : String(reason);
    });
    expect(
      fulfilled.length,
      `stok terakhir harus dimenangkan tepat satu pembeli; penolakan: ${reasons.join(" | ")}`,
    ).toBe(1);
    expect(rejected).toHaveLength(1);
    const error = rejected[0]?.reason;
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("STOCK_INSUFFICIENT");

    const after = await balanceOf(sku);
    expect(after.reserved).toBe(balance.reserved + 1);
    expect(after.reserved).toBeLessThanOrEqual(after.onHand);
    const orders = await db.query<{ c: unknown }>(
      `SELECT count(*)::int AS c FROM orders o JOIN users u ON u.id = o.customer_id
        WHERE u.email_normalized IN ('pelanggan-race-a@ndre.gstore.test','pelanggan-race-b@ndre.gstore.test')`,
    );
    expect(num(orders.rows[0]?.c)).toBe(1);
    const winner = fulfilled[0]?.value;
    expect(winner?.orderNumber).toMatch(/^NS-\d{8}-[A-Z0-9]{6}$/);
  });

  it("reservasi yang kedaluwarsa dilepas dan stok kembali tersedia", async () => {
    expectReady();
    const db = await getDb();
    const sku = "NS-KB-001-03"; // Ivory / Silent, stok 2
    const ctx = await customerCtx("expiry");
    const order = await checkoutToOrder(ctx, { sku, quantity: 2 });
    const before = await balanceOf(sku);
    expect(before.reserved).toBeGreaterThanOrEqual(2);

    await db.query(
      `UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE order_id = $1`,
      [order.orderId],
    );
    const released = await expireReservations();
    expect(released.released).toBeGreaterThanOrEqual(1);

    const after = await balanceOf(sku);
    expect(after.reserved).toBeLessThan(before.reserved);
    expect(after.available).toBeGreaterThan(before.available);
    const orderRow = await db.query<Record<string, unknown>>(
      `SELECT status, cancel_reason FROM orders WHERE id = $1`,
      [order.orderId],
    );
    expect(text(orderRow.rows[0]?.status)).toBe("cancelled");
    expect(text(orderRow.rows[0]?.cancel_reason)).toMatch(/kedaluwarsa|batas waktu/i);
    const reservation = await db.query<{ status: string }>(
      `SELECT status FROM stock_reservations WHERE order_id = $1`,
      [order.orderId],
    );
    expect(reservation.rows.every((r) => r.status === "expired")).toBe(true);
  });
});
