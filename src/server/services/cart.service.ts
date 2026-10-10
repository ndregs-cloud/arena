import "server-only";
import { hashOpaque } from "@/platform/crypto-helpers";
import { AppError } from "@/domain/errors";
import {
  buildQuote,
  type PricingLine,
  type Promotion,
  type ShippingSelection,
} from "@/domain/pricing";
import { bool, date, getDb, jsonb, num, optNum, optText, text } from "@/platform/db";
import type { RequestContext } from "@/server/context";
import { assertPurchasable } from "@/server/services/inventory.service";
import { findPromotionById, tryApplyCoupon } from "@/server/services/promotion.service";

/**
 * Cart & draft checkout (Blueprint §5.3). Cart hidup di server:
 * - harga dibaca ulang dari DB setiap render (harga dari klien diabaikan, AT-03);
 * - kuantitas divalidasi terhadap stok + min/max, server mengembalikan jumlah yang dapat dibeli;
 * - keranjang tidak menjanjikan reservasi stok (reservasi dibuat saat order dibuat).
 */

export interface CartLine {
  cartItemId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantId: string;
  variantLabel: string;
  sku: string;
  unitPriceAmount: number;
  compareAtAmount: number | null;
  quantity: number;
  maxQuantity: number;
  lineTotalAmount: number;
  imageUrl: string | null;
  imageAlt: string | null;
  available: number;
  trackInventory: boolean;
  categoryId: string;
  isSavedForLater: boolean;
}

export interface DraftAddress {
  fullName: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  postalCode: string;
  street: string;
  landmark: string | null;
}

export interface DraftPayment {
  methodCode: string;
  methodName: string;
}

export interface CheckoutDraft {
  contact: { email: string; phone: string } | null;
  address: DraftAddress | null;
  shipping: ShippingSelection | null;
  payment: DraftPayment | null;
  couponCode: string | null;
  termsAcceptedAt: string | null;
  policyVersion: string | null;
  marketingConsent: boolean;
}

export interface CartTotals {
  subtotalAmount: number;
  discountAmount: number;
  shippingAmount: number;
  feeAmount: number;
  totalAmount: number;
  lineDiscounts: Record<string, number>;
  promotionId: string | null;
  freeShippingApplied: boolean;
}

export interface CartView {
  cartId: string;
  lines: CartLine[];
  itemCount: number;
  totals: CartTotals;
  currency: "IDR";
  promotion: { code: string; label: string; kind: Promotion["kind"] } | null;
  shippingQuote: ShippingSelection | null;
  draft: CheckoutDraft;
  warnings: Array<{ cartItemId: string | null; message: string }>;
  weightGrams: number;
  isEmpty: boolean;
}

export const EMPTY_DRAFT: CheckoutDraft = {
  contact: null,
  address: null,
  shipping: null,
  payment: null,
  couponCode: null,
  termsAcceptedAt: null,
  policyVersion: null,
  marketingConsent: false,
};

interface CartRecord {
  id: string;
  draft: CheckoutDraft;
  promotionId: string | null;
}

function mapCartRow(row: Record<string, unknown> | undefined): CartRecord | null {
  if (!row) return null;
  const draft = { ...EMPTY_DRAFT, ...jsonb<Partial<CheckoutDraft>>(row.draft, {}) };
  // Draft lewat JSONB mengubah Date menjadi string ISO; domain mengharapkan Date.
  // Revive di batas ini supaya cek kesegaran kutipan ongkir tidak melempar TypeError saat checkout.
  if (draft.shipping) {
    draft.shipping = {
      ...draft.shipping,
      quotedAt: date(draft.shipping.quotedAt) ?? new Date(0),
      expiresAt: date(draft.shipping.expiresAt),
    };
  }
  return { id: text(row.id), draft, promotionId: optText(row.promotion_id) };
}

/**
 * Baca cart aktif TANPA menulis. Halaman (render) hanya menampilkan keranjang, jadi tidak boleh
 * membuat baris cart baru - kalau tidak, dua segmen yang dirender paralel (layout + page) bisa
 * saling menabrak unique index token_hash. Cart dibuat saat mutasi pertama (addToCart/draft).
 */
export async function readCart(ctx: RequestContext): Promise<CartRecord | null> {
  const db = await getDb();
  if (ctx.user) {
    const res = await db.query<Record<string, unknown>>(
      `SELECT * FROM carts WHERE user_id = $1 AND status = 'active' ORDER BY created_at ASC LIMIT 1`,
      [ctx.user.id],
    );
    return mapCartRow(res.rows[0]);
  }
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM carts WHERE token_hash = $1 AND status = 'active' LIMIT 1`,
    [hashOpaque(ctx.cartToken)],
  );
  return mapCartRow(res.rows[0]);
}

const EMPTY_CART: CartRecord = { id: "", draft: EMPTY_DRAFT, promotionId: null };

export async function findOrCreateCart(ctx: RequestContext): Promise<CartRecord> {
  const existing = await readCart(ctx);
  if (existing) return existing;
  const db = await getDb();
  if (ctx.user) {
    try {
      const created = await db.query<Record<string, unknown>>(
        `INSERT INTO carts (user_id, status) VALUES ($1, 'active') RETURNING *`,
        [ctx.user.id],
      );
      const row = mapCartRow(created.rows[0]);
      if (row) return row;
    } catch (error) {
      // Dua tab bisa membuat bersamaan; pakai yang sudah ada (idempoten).
      if (!isUniqueViolation(error)) throw error;
    }
    const after = await readCart(ctx);
    if (after) return after;
    throw new AppError("INTERNAL_ERROR", "Keranjang tidak dapat dibuat.", { status: 500 });
  }
  const tokenHash = hashOpaque(ctx.cartToken);
  const created = await db.query<Record<string, unknown>>(
    `INSERT INTO carts (token_hash, status) VALUES ($1, 'active') ON CONFLICT (token_hash) DO NOTHING RETURNING *`,
    [tokenHash],
  );
  const row = mapCartRow(created.rows[0]);
  if (row) return row;
  const after = await readCart(ctx);
  if (after) return after;
  throw new AppError("INTERNAL_ERROR", "Keranjang tidak dapat dibuat.", { status: 500 });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "23505"
  );
}

const CART_ITEMS_SQL = `
  SELECT ci.id AS cart_item_id, ci.quantity, ci.saved_for_later,
         v.id AS variant_id, v.sku, v.label AS variant_label, v.price_amount, v.compare_at_amount,
         v.track_inventory, v.min_qty_per_order, v.max_qty_per_order, v.is_active, v.is_deleted,
         p.id AS product_id, p.slug AS product_slug, p.name AS product_name, p.category_id, p.status AS product_status,
         (p.attributes->>'berat_gram')::int AS weight_grams,
         COALESCE(ib.available, 0)::int AS available,
         m.url AS media_url, m.alt_text AS media_alt
    FROM cart_items ci
    JOIN product_variants v ON v.id = ci.variant_id
    JOIN products p ON p.id = v.product_id
    LEFT JOIN inventory_balances ib ON ib.sku = v.sku
    LEFT JOIN LATERAL (
      SELECT pm.url, pm.alt_text FROM product_media pm
       WHERE pm.product_id = p.id ORDER BY pm.is_primary DESC, pm.position LIMIT 1
    ) m ON true
   WHERE ci.cart_id = $1
   ORDER BY ci.saved_for_later ASC, ci.added_at ASC
`;

interface LoadedCart {
  cart: CartRecord;
  rows: Record<string, unknown>[];
}

async function loadCartRows(ctx: RequestContext): Promise<LoadedCart> {
  const cart = (await readCart(ctx)) ?? EMPTY_CART;
  if (!cart.id) return { cart, rows: [] };
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(CART_ITEMS_SQL, [cart.id]);
  return { cart, rows: res.rows };
}

export function toPricingLine(row: Record<string, unknown>): PricingLine {
  return {
    lineId: text(row.cart_item_id),
    variantId: text(row.variant_id),
    productId: text(row.product_id),
    sku: text(row.sku),
    name: text(row.product_name),
    variantLabel: text(row.variant_label),
    unitPriceAmount: num(row.price_amount),
    quantity: num(row.quantity),
    categoryId: text(row.category_id),
    maxQuantity: optNum(row.max_qty_per_order),
    imageUrl: optText(row.media_url),
  };
}

async function assembleView(ctx: RequestContext, loaded: LoadedCart, at: Date): Promise<CartView> {
  const warnings: CartView["warnings"] = [];
  const lines: CartLine[] = [];
  const pricingLines: PricingLine[] = [];
  let weightGrams = 0;

  for (const row of loaded.rows) {
    const trackInventory = bool(row.track_inventory);
    const available = trackInventory ? num(row.available) : 999;
    const quantity = num(row.quantity);
    const isSaved = bool(row.saved_for_later);
    const perUnitWeight = Math.max(1, num(row.weight_grams, 400));
    if (!isSaved) weightGrams += perUnitWeight * quantity;

    const stockMax = trackInventory ? Math.max(0, available) : num(row.max_qty_per_order) || 999;
    const perOrderMax = num(row.max_qty_per_order) || stockMax;
    const maxQuantity = Math.max(1, Math.min(stockMax, perOrderMax));

    if (trackInventory && quantity > available && !isSaved) {
      warnings.push({
        cartItemId: text(row.cart_item_id),
        message: `Stok ${text(row.product_name)} tinggal ${available}. Jumlah akan disesuaikan saat checkout.`,
      });
    }
    if (bool(row.is_deleted) || !bool(row.is_active) || text(row.product_status) !== "published") {
      warnings.push({
        cartItemId: text(row.cart_item_id),
        message: "Ada item yang tidak dapat dipesan lagi. Hapus dari keranjang untuk melanjutkan.",
      });
    }

    lines.push({
      cartItemId: text(row.cart_item_id),
      productId: text(row.product_id),
      productSlug: text(row.product_slug),
      productName: text(row.product_name),
      variantId: text(row.variant_id),
      variantLabel: text(row.variant_label),
      sku: text(row.sku),
      unitPriceAmount: num(row.price_amount),
      compareAtAmount: optNum(row.compare_at_amount),
      quantity,
      maxQuantity: isSaved ? quantity : maxQuantity,
      lineTotalAmount: num(row.price_amount) * quantity,
      imageUrl: optText(row.media_url),
      imageAlt: optText(row.media_alt),
      available,
      trackInventory,
      categoryId: text(row.category_id),
      isSavedForLater: isSaved,
    });
    if (!isSaved) pricingLines.push(toPricingLine(row));
  }

  let promotion: Promotion | null = null;
  if (loaded.cart.promotionId) {
    promotion = await findPromotionById(loaded.cart.promotionId, ctx.user?.id ?? null);
  } else if (loaded.cart.draft.couponCode && pricingLines.length > 0) {
    try {
      const applied = await tryApplyCoupon(
        loaded.cart.draft.couponCode,
        pricingLines,
        ctx.user?.id ?? null,
        at,
      );
      promotion = applied.promotion;
    } catch {
      promotion = null;
      warnings.push({
        cartItemId: null,
        message: "Kode promo sebelumnya tidak lagi berlaku untuk isi keranjang ini.",
      });
    }
  }

  const totals: CartTotals =
    pricingLines.length === 0
      ? {
          subtotalAmount: 0,
          discountAmount: 0,
          shippingAmount: 0,
          feeAmount: 0,
          totalAmount: 0,
          lineDiscounts: {},
          promotionId: null,
          freeShippingApplied: false,
        }
      : (() => {
          const q = buildQuote({
            lines: pricingLines,
            promotion,
            shipping: loaded.cart.draft.shipping,
            at,
          });
          return {
            subtotalAmount: q.subtotalAmount,
            discountAmount: q.discountAmount,
            shippingAmount: q.shippingAmount,
            feeAmount: q.feeAmount,
            totalAmount: q.totalAmount,
            lineDiscounts: q.lineDiscounts,
            promotionId: q.promotionId,
            freeShippingApplied: q.freeShippingApplied,
          };
        })();

  return {
    cartId: loaded.cart.id,
    lines,
    itemCount: lines.filter((l) => !l.isSavedForLater).reduce((acc, l) => acc + l.quantity, 0),
    totals,
    currency: "IDR",
    promotion:
      promotion && totals.promotionId
        ? { code: promotion.code, label: promotion.label, kind: promotion.kind }
        : null,
    shippingQuote: loaded.cart.draft.shipping,
    draft: loaded.cart.draft,
    warnings,
    weightGrams,
    isEmpty: lines.filter((l) => !l.isSavedForLater).length === 0,
  };
}

export async function getCartView(
  ctx: RequestContext,
  options: { at?: Date } = {},
): Promise<CartView> {
  const loaded = await loadCartRows(ctx);
  return assembleView(ctx, loaded, options.at ?? new Date());
}

/** Data mentah cart + totals - dipakai checkout untuk membuat snapshot order (satu sumber kebenaran). */
export async function getCartSnapshot(
  ctx: RequestContext,
  at: Date = new Date(),
): Promise<{ view: CartView; rows: Record<string, unknown>[] }> {
  const loaded = await loadCartRows(ctx);
  return { view: await assembleView(ctx, loaded, at), rows: loaded.rows };
}

export async function addToCart(
  ctx: RequestContext,
  variantId: string,
  requestedQuantity: number,
): Promise<{ cart: CartView; appliedQuantity: number; message: string }> {
  const db = await getDb();
  const variantRes = await db.query<Record<string, unknown>>(
    `SELECT v.id, v.min_qty_per_order, v.max_qty_per_order, v.is_active, v.is_deleted, p.status AS product_status, p.name
       FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`,
    [variantId],
  );
  const variant = variantRes.rows[0];
  if (!variant || bool(variant.is_deleted) || !bool(variant.is_active)) {
    throw new AppError("NOT_FOUND", "Varian tidak tersedia.", { status: 404 });
  }
  // AT-01: produk draft/archived tidak dapat dibeli, bahkan lewat panggilan langsung.
  if (text(variant.product_status) !== "published" && !ctx.canPreviewCatalog) {
    throw new AppError("PRODUCT_NOT_PUBLISHED", "Produk ini belum tersedia untuk pembelian.", {
      status: 422,
    });
  }
  const min = num(variant.min_qty_per_order, 1);
  const max = optNum(variant.max_qty_per_order);
  // Kuantitas diminta disesuaikan ke batas yang sah (max per pesanan / stok tersedia) dan
  // pesan dikembalikan ke UI - bukan gagal senyap, bukan juga menolak user yang salah ketik.
  let quantity = Math.max(1, Math.trunc(requestedQuantity));
  let notice = "";
  if (max !== null && quantity > max) {
    quantity = max;
    notice = `Jumlah dibatasi maksimal ${max} per pesanan untuk produk ini.`;
  }
  try {
    await assertPurchasable(variantId, quantity);
  } catch (error) {
    if (error instanceof AppError && error.code === "STOCK_INSUFFICIENT") {
      const available = num(error.details?.availableQuantity ?? 0);
      if (available < min) throw error;
      quantity = Math.min(quantity, available);
      notice = `Stok tersedia ${available}; jumlah disesuaikan agar pesanan tidak gagal.`;
    } else {
      throw error;
    }
  }
  if (quantity < min) {
    throw new AppError("VALIDATION_FAILED", `Minimal pembelian ${min} untuk produk ini.`, {
      status: 422,
    });
  }

  const cart = await findOrCreateCart(ctx);
  await db.query(
    `INSERT INTO cart_items (cart_id, variant_id, quantity) VALUES ($1,$2,$3)
     ON CONFLICT (cart_id, variant_id) DO UPDATE
       SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity, COALESCE($4, 999)), updated_at = now()`,
    [cart.id, variantId, quantity, optNum(variant.max_qty_per_order)],
  );
  await db.query("UPDATE carts SET updated_at = now() WHERE id = $1", [cart.id]);

  const view = await getCartView(ctx);
  const line = view.lines.find((l) => l.variantId === variantId);
  const base = `${text(variant.name)} ditambahkan ke keranjang`;
  return {
    cart: view,
    appliedQuantity: line?.quantity ?? quantity,
    message: notice ? `${base}. ${notice}` : base,
  };
}

export async function updateCartLineQuantity(
  ctx: RequestContext,
  cartItemId: string,
  requestedQuantity: number,
): Promise<{ cart: CartView; message: string; adjusted: boolean }> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT ci.variant_id, ci.quantity FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
      WHERE ci.id = $1 AND (c.user_id = $2 OR ($2 IS NULL AND c.token_hash = $3))`,
    [cartItemId, ctx.user?.id ?? null, hashOpaque(ctx.cartToken)],
  );
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Item keranjang tidak ditemukan.", { status: 404 });

  if (requestedQuantity <= 0) {
    await db.query("DELETE FROM cart_items WHERE id = $1", [cartItemId]);
    return {
      cart: await getCartView(ctx),
      message: "Item dihapus dari keranjang.",
      adjusted: false,
    };
  }

  const variantId = text(row.variant_id);
  const stockRes = await db.query<Record<string, unknown>>(
    `SELECT v.track_inventory, v.max_qty_per_order, v.min_qty_per_order, COALESCE(ib.available,0)::int AS available
       FROM product_variants v LEFT JOIN inventory_balances ib ON ib.sku = v.sku WHERE v.id = $1`,
    [variantId],
  );
  const vrow = stockRes.rows[0] ?? {};
  let applied = Math.trunc(requestedQuantity);
  let adjusted = false;
  if (bool(vrow.track_inventory)) {
    const cap = Math.min(
      num(vrow.available),
      num(vrow.max_qty_per_order) || Number.POSITIVE_INFINITY,
    );
    if (applied > cap) {
      applied = Math.max(num(vrow.min_qty_per_order, 1), Math.max(1, cap));
      adjusted = true;
    }
  }
  await assertPurchasable(variantId, applied);
  await db.query("UPDATE cart_items SET quantity = $2, updated_at = now() WHERE id = $1", [
    cartItemId,
    applied,
  ]);
  return {
    cart: await getCartView(ctx),
    adjusted,
    message: adjusted
      ? `Jumlah disesuaikan dengan stok tersedia (${applied}).`
      : "Jumlah diperbarui.",
  };
}

export async function removeCartLine(
  ctx: RequestContext,
  cartItemId: string,
  action: "remove" | "save_for_later" = "remove",
): Promise<CartView> {
  const db = await getDb();
  if (action === "save_for_later") {
    await db.query(
      "UPDATE cart_items SET saved_for_later = true, updated_at = now() WHERE id = $1",
      [cartItemId],
    );
  } else {
    await db.query("DELETE FROM cart_items WHERE id = $1", [cartItemId]);
  }
  return getCartView(ctx);
}

export async function applyCoupon(
  ctx: RequestContext,
  code: string,
): Promise<{ cart: CartView; message: string }> {
  const loaded = await loadCartRows(ctx);
  const pricingLines = loaded.rows.filter((r) => !bool(r.saved_for_later)).map(toPricingLine);
  const { promotion } = await tryApplyCoupon(code, pricingLines, ctx.user?.id ?? null);
  const db = await getDb();
  await db.query(
    `UPDATE carts SET promotion_id = $2, draft = jsonb_set(draft, '{couponCode}', $3::jsonb), updated_at = now() WHERE id = $1`,
    [loaded.cart.id, promotion.id, JSON.stringify(promotion.code)],
  );
  return { cart: await getCartView(ctx), message: `Promo "${promotion.label}" diterapkan.` };
}

export async function removeCoupon(ctx: RequestContext): Promise<CartView> {
  const loaded = await loadCartRows(ctx);
  const db = await getDb();
  await db.query(
    `UPDATE carts SET promotion_id = NULL, draft = jsonb_set(draft, '{couponCode}', 'null'::jsonb), updated_at = now() WHERE id = $1`,
    [loaded.cart.id],
  );
  return getCartView(ctx);
}

/** Simpan draft per langkah. Data tidak dihapus saat pengguna kembali (desain §10.4 anti-pattern). */
export async function saveCheckoutDraft(
  ctx: RequestContext,
  patch: Partial<CheckoutDraft>,
): Promise<CartView> {
  const loaded = await loadCartRows(ctx);
  const merged: CheckoutDraft = { ...loaded.cart.draft, ...patch };
  const db = await getDb();
  await db.query("UPDATE carts SET draft = $2::jsonb, updated_at = now() WHERE id = $1", [
    loaded.cart.id,
    JSON.stringify(merged),
  ]);
  return getCartView(ctx);
}

export async function clearCheckoutShipping(ctx: RequestContext): Promise<CartView> {
  return saveCheckoutDraft(ctx, { shipping: null });
}

/** Merge cart tamu ke cart akun setelah login (Blueprint §5.3). */
export async function mergeGuestCartIntoAccount(
  ctx: RequestContext,
): Promise<{ mergedItems: number }> {
  if (!ctx.user) return { mergedItems: 0 };
  const db = await getDb();
  const tokenHash = hashOpaque(ctx.cartToken);
  const guest = await db.query<{ id: string }>(
    `SELECT id FROM carts WHERE token_hash = $1 AND status = 'active' LIMIT 1`,
    [tokenHash],
  );
  const guestId = guest.rows[0]?.id;
  if (!guestId) return { mergedItems: 0 };
  const target = await findOrCreateCart(ctx);
  const moved = await db.query(
    `INSERT INTO cart_items (cart_id, variant_id, quantity, added_at, updated_at)
     SELECT $1, ci.variant_id, ci.quantity, now(), now() FROM cart_items ci
      WHERE ci.cart_id = $2 AND ci.saved_for_later = false
     ON CONFLICT (cart_id, variant_id) DO UPDATE
       SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity, 999), updated_at = now()
     RETURNING id`,
    [target.id, guestId],
  );
  await db.query("UPDATE carts SET status='merged', merged_into=$2, updated_at=now() WHERE id=$1", [
    guestId,
    target.id,
  ]);
  return { mergedItems: moved.rows.length };
}

export function cartLinesSummary(view: CartView): string {
  if (view.lines.length === 0) return "Keranjang kosong";
  return view.lines
    .map((l) => `${l.productName}${l.variantLabel ? ` (${l.variantLabel})` : ""} x${l.quantity}`)
    .join(", ");
}

export function draftHasValidAddress(draft: CheckoutDraft): boolean {
  return Boolean(
    draft.address?.fullName &&
    draft.address.street &&
    draft.address.postalCode &&
    draft.address.province &&
    draft.address.city &&
    draft.address.district &&
    draft.address.phone,
  );
}
