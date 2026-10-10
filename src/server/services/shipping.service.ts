import "server-only";
import { AppError } from "@/domain/errors";
import { isQuoteExpired, quoteSimulatedServices } from "@/domain/shipping";
import type { ShippingSelection } from "@/domain/pricing";
import { getDb, num, optText, text } from "@/platform/db";
import { shippingProvider } from "@/platform/shipping";
import {
  getCartView,
  saveCheckoutDraft,
  type CartView,
  type DraftAddress,
} from "@/server/services/cart.service";
import type { RequestContext } from "@/server/context";
import { formatIDR } from "@/lib/format";

/**
 * Kutipan pengiriman untuk langkah checkout (Blueprint §6.1, §7.2; desain §9.1).
 * Semua angka ditandai asalnya (simulasi vs provider) dan diberi kedaluwarsa;
 * nilai final tetap dihitung ulang oleh server saat order dibuat.
 */

export interface ShippingOption {
  carrierCode: string;
  serviceCode: string;
  serviceName: string;
  costAmount: number;
  costLabel: string;
  estimateLabel: string;
  isSimulated: boolean;
  selected: boolean;
  expiresAt: Date | null;
}

export interface ShippingOptionsResult {
  options: ShippingOption[];
  requiresAddress: boolean;
  address: DraftAddress | null;
  source: "provider" | "simulated" | "fallback_manual";
  warning: string | null;
  quoteNote: string;
  weightGrams: number;
  cart: CartView;
}

export async function getShippingOptions(ctx: RequestContext): Promise<ShippingOptionsResult> {
  const cart = await getCartView(ctx);
  const address = cart.draft.address;
  if (!address) {
    return {
      options: [],
      requiresAddress: true,
      address: null,
      source: "simulated",
      warning: "Lengkapi alamat pengiriman terlebih dahulu untuk melihat opsi dan ongkos kirim.",
      quoteNote: "Ongkos kirim dihitung dari provinsi tujuan dan total berat varian.",
      weightGrams: cart.weightGrams,
      cart,
    };
  }

  const provider = shippingProvider();
  let services: Array<{
    carrierCode: string;
    serviceCode: string;
    serviceName: string;
    costAmount: number;
    estimateLabel: string;
    isSimulated: boolean;
  }> = [];
  let source: ShippingOptionsResult["source"] = "simulated";
  let warning: string | null = null;
  let quotedAt = new Date();
  let expiresAt = new Date(Date.now() + 30 * 60_000);

  const adapterResult = await provider
    .quote({
      province: address.province,
      city: address.city,
      district: address.district,
      postalCode: address.postalCode,
      weightGrams: cart.weightGrams,
      itemCount: cart.itemCount,
    })
    .catch((error) => {
      warning = `Kutipan dari penyedia gagal (${error instanceof Error ? error.message : "tidak diketahui"}). Menampilkan kartu tarif simulasi internal.`;
      return null;
    });

  if (adapterResult && adapterResult.services.length > 0) {
    services = adapterResult.services;
    source = adapterResult.source;
    quotedAt = adapterResult.quotedAt;
    expiresAt = adapterResult.expiresAt;
    warning = adapterResult.warning ?? warning;
  } else {
    services = quoteSimulatedServices(
      { province: address.province, weightGrams: cart.weightGrams, itemCount: cart.itemCount },
      new Date(),
    ).map((q) => ({
      carrierCode: q.carrierCode,
      serviceCode: q.serviceCode,
      serviceName: q.serviceName,
      costAmount: q.costAmount,
      estimateLabel: q.estimateLabel,
      isSimulated: true,
    }));
    source = "simulated";
    warning =
      provider.unavailableReason() ??
      warning ??
      "Tarif kurir resmi belum terhubung; angka di bawah adalah simulasi internal.";
  }

  const selectedKey = cart.draft.shipping
    ? `${cart.draft.shipping.carrierCode}:${cart.draft.shipping.serviceCode}`
    : null;
  const options: ShippingOption[] = services.map((service) => ({
    carrierCode: service.carrierCode,
    serviceCode: service.serviceCode,
    serviceName: service.serviceName,
    costAmount: service.costAmount,
    costLabel: service.costAmount === 0 ? "Gratis" : formatIDR(service.costAmount),
    estimateLabel: service.estimateLabel,
    isSimulated: service.isSimulated,
    selected: selectedKey === `${service.carrierCode}:${service.serviceCode}`,
    expiresAt,
  }));

  return {
    options,
    requiresAddress: false,
    address,
    source,
    warning,
    quoteNote: `Kutipan berlaku sampai ${expiresAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}. Total akhir dihitung ulang saat pesanan dibuat.`,
    weightGrams: cart.weightGrams,
    cart,
  };
}

export async function selectShipping(
  ctx: RequestContext,
  input: { carrierCode: string; serviceCode: string },
): Promise<{ selection: ShippingSelection; cart: CartView; message: string }> {
  const result = await getShippingOptions(ctx);
  const option = result.options.find(
    (o) =>
      o.serviceCode === input.serviceCode &&
      (o.carrierCode === input.carrierCode ||
        input.carrierCode === "any" ||
        input.carrierCode === ""),
  );
  if (!option) {
    throw new AppError(
      "SHIPPING_PROVIDER_UNAVAILABLE",
      "Opsi pengiriman tidak tersedia untuk alamat ini. Pilih opsi lain.",
      { status: 422 },
    );
  }
  const selection: ShippingSelection = {
    costAmount: option.costAmount,
    serviceCode: option.serviceCode,
    serviceName: option.serviceName,
    carrierCode: option.carrierCode,
    estimateLabel: option.estimateLabel,
    quotedAt: new Date(),
    expiresAt: result.options[0]?.expiresAt ?? null,
    isSimulated: option.isSimulated,
  };
  if (isQuoteExpired(selection.expiresAt, new Date())) {
    throw new AppError(
      "SHIPPING_QUOTE_EXPIRED",
      "Kutipan pengiriman kedaluwarsa. Muat ulang opsi lalu pilih lagi.",
      { status: 422 },
    );
  }
  const cart = await saveCheckoutDraft(ctx, { shipping: selection });
  return {
    selection,
    cart,
    message: `${option.serviceName} dipilih - ${option.costLabel}, ${option.estimateLabel}${option.isSimulated ? " (simulasi)" : ""}.`,
  };
}

export async function clearShippingSelection(ctx: RequestContext): Promise<CartView> {
  return saveCheckoutDraft(ctx, { shipping: null });
}

/** Ringkasan berat per baris untuk UI (dari atribut produk, bukan dari klien). */
export async function cartWeightBreakdown(
  ctx: RequestContext,
): Promise<Array<{ lineId: string; name: string; grams: number }>> {
  const cart = await getCartView(ctx);
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT ci.id, p.name, COALESCE((p.attributes->>'berat_gram')::int, 0) AS grams, ci.quantity
       FROM carts c JOIN cart_items ci ON ci.cart_id = c.id
       JOIN product_variants v ON v.id = ci.variant_id JOIN products p ON p.id = v.product_id
      WHERE c.id = $1 AND ci.saved_for_later = false`,
    [cart.cartId],
  );
  return res.rows.map((r) => ({
    lineId: text(r.id),
    name: text(r.name),
    grams: num(r.grams) * num(r.quantity),
  }));
}

/** Alamat tersimpan pelanggan untuk pengisian cepat langkah alamat. */
export async function savedAddressesForCheckout(
  ctx: RequestContext,
): Promise<Array<{ id: string; label: string; address: DraftAddress; isDefault: boolean }>> {
  if (!ctx.user) return [];
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT id, label, is_default, full_name, phone, province, city, district, postal_code, street, landmark
       FROM addresses WHERE user_id = $1 AND is_deleted = false ORDER BY is_default DESC, created_at ASC`,
    [ctx.user.id],
  );
  return res.rows.map((row) => ({
    id: text(row.id),
    label: text(row.label),
    isDefault: row.is_default === true,
    address: {
      fullName: text(row.full_name),
      phone: text(row.phone),
      province: text(row.province),
      city: text(row.city),
      district: text(row.district),
      postalCode: text(row.postal_code),
      street: text(row.street),
      landmark: optText(row.landmark),
    },
  }));
}

export async function useSavedAddress(ctx: RequestContext, addressId: string): Promise<CartView> {
  if (!ctx.user)
    throw new AppError("UNAUTHENTICATED", "Masuk untuk memakai alamat tersimpan.", { status: 401 });
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT full_name, phone, province, city, district, postal_code, street, landmark FROM addresses WHERE id = $1 AND user_id = $2 AND is_deleted = false`,
    [addressId, ctx.user.id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Alamat tidak ditemukan.", { status: 404 });
  const address: DraftAddress = {
    fullName: text(row.full_name),
    phone: text(row.phone),
    province: text(row.province),
    city: text(row.city),
    district: text(row.district),
    postalCode: text(row.postal_code),
    street: text(row.street),
    landmark: optText(row.landmark),
  };
  // Alamat berbeda membatalkan kutipan pengiriman yang lama.
  return saveCheckoutDraft(ctx, { address, shipping: null });
}

export function shippingSourceLabel(source: ShippingOptionsResult["source"]): string {
  return source === "provider"
    ? "Tarif dari penyedia"
    : source === "fallback_manual"
      ? "Entri manual (perlu verifikasi)"
      : "Simulasi internal";
}
