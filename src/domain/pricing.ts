import { AppError } from "@/domain/errors";
import { isWithin, systemClock, type Clock } from "@/domain/clock";
import {
  allocateByWeights,
  applyBasisPoints,
  clampDiscount,
  DEFAULT_CURRENCY,
  type CurrencyCode,
} from "@/domain/money";

/**
 * Mesin harga SATU-SATUNYA (Blueprint §6.1 Pricing snapshot, §9.3 Kupon & diskon).
 * Browser tidak pernah menentukan harga final (prinsip "Server is authoritative").
 *
 * Aturan yang didokumentasikan eksplisit ( Blueprint §9.3 ):
 * - minimum spend dihitung SEBELUM diskon item dan TANPA ongkir.
 * - Satu kupon manual tidak dapat ditumpuk dengan kupon manual lain (stacking default: false).
 * - Prioritas promo: free_shipping > percent > fixed (angka lebih tinggi menang bila beberapa kandidat).
 * - Alokasi diskon per line memakai largest-remainder agar refund parsial tepat (AT-08).
 */

export const PROMOTION_KINDS = ["percent", "fixed", "free_shipping"] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

export interface PromotionScope {
  categoryIds?: string[];
  productIds?: string[];
  variantIds?: string[];
}

export interface Promotion {
  id: string;
  code: string;
  label: string;
  kind: PromotionKind;
  /** percent = basis points (1000 = 10%), fixed = rupiah, free_shipping = diabaikan. */
  value: number;
  minSpendAmount: number;
  discountCapAmount: number | null;
  scope: PromotionScope | null;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  perCustomerLimit: number | null;
  redemptionsByCustomer: number;
  isActive: boolean;
  stackable: boolean;
}

export interface PricingLine {
  lineId: string;
  variantId: string;
  productId: string;
  sku: string;
  name: string;
  variantLabel: string;
  unitPriceAmount: number;
  quantity: number;
  categoryId: string;
  maxQuantity: number | null;
  imageUrl?: string | null;
}

export interface ShippingSelection {
  /** Biaya dari kutipan pengiriman; 0 berarti gratis. */
  costAmount: number;
  serviceCode: string;
  serviceName: string;
  carrierCode: string;
  estimateLabel: string;
  quotedAt: Date;
  expiresAt: Date | null;
  isSimulated: boolean;
}

export interface QuoteTotals {
  currency: CurrencyCode;
  subtotalAmount: number;
  discountAmount: number;
  shippingAmount: number;
  feeAmount: number;
  totalAmount: number;
  lineDiscounts: Record<string, number>;
  promotionId: string | null;
  promotionCode: string | null;
  promotionLabel: string | null;
  freeShippingApplied: boolean;
}

export interface QuoteContext {
  clock?: Clock;
  at: Date;
}

export interface PromotionEvaluation {
  eligible: boolean;
  reasonCode?:
    | "OK"
    | "INACTIVE"
    | "OUT_OF_WINDOW"
    | "MIN_SPEND"
    | "SCOPE"
    | "USAGE_LIMIT"
    | "PER_CUSTOMER_LIMIT"
    | "ALREADY_APPLIED";
  message?: string;
}

function lineSubtotal(line: PricingLine): number {
  return Math.trunc(line.unitPriceAmount) * Math.trunc(line.quantity);
}

function isLineInScope(line: PricingLine, scope: PromotionScope | null): boolean {
  if (!scope) return true;
  const { categoryIds, productIds, variantIds } = scope;
  const empty = !categoryIds?.length && !productIds?.length && !variantIds?.length;
  if (empty) return true;
  if (categoryIds?.length && categoryIds.includes(line.categoryId)) return true;
  if (productIds?.length && productIds.includes(line.productId)) return true;
  if (variantIds?.length && variantIds.includes(line.variantId)) return true;
  return false;
}

export function evaluatePromotion(
  promotion: Promotion | null,
  lines: readonly PricingLine[],
  context: QuoteContext,
): PromotionEvaluation {
  if (!promotion) return { eligible: false, reasonCode: "OK", message: "Belum ada kode promo." };
  const clock = context.clock ?? systemClock;
  if (!promotion.isActive)
    return { eligible: false, reasonCode: "INACTIVE", message: "Promo sedang tidak aktif." };
  if (
    !isWithin({ startsAt: promotion.startsAt, endsAt: promotion.endsAt }, context.at ?? clock.now())
  ) {
    return {
      eligible: false,
      reasonCode: "OUT_OF_WINDOW",
      message:
        "Kode promo berada di luar periode berlaku. Periksa tanggal mulai dan akhir kampanye.",
    };
  }
  const eligibleSubtotal = lines
    .filter((l) => isLineInScope(l, promotion.scope))
    .reduce((acc, l) => acc + lineSubtotal(l), 0);
  if (eligibleSubtotal <= 0) {
    return {
      eligible: false,
      reasonCode: "SCOPE",
      message: "Kode tidak berlaku untuk item di keranjang ini. Periksa syarat promo.",
    };
  }
  if (eligibleSubtotal < promotion.minSpendAmount) {
    const gap = promotion.minSpendAmount - eligibleSubtotal;
    return {
      eligible: false,
      reasonCode: "MIN_SPEND",
      message: `Belum memenuhi minimum belanja. Kurang Rp${gap.toLocaleString("id-ID")} (dihitung sebelum diskon, tanpa ongkir).`,
    };
  }
  if (promotion.usageLimit !== null && promotion.usedCount >= promotion.usageLimit) {
    return { eligible: false, reasonCode: "USAGE_LIMIT", message: "Kuota promo sudah habis." };
  }
  if (
    promotion.perCustomerLimit !== null &&
    promotion.redemptionsByCustomer >= promotion.perCustomerLimit
  ) {
    return {
      eligible: false,
      reasonCode: "PER_CUSTOMER_LIMIT",
      message: "Anda sudah mencapai batas pemakaian kode ini.",
    };
  }
  return { eligible: true, reasonCode: "OK" };
}

function computeDiscount(promotion: Promotion, eligibleSubtotal: number): number {
  switch (promotion.kind) {
    case "percent": {
      const raw = applyBasisPoints(eligibleSubtotal, promotion.value);
      return promotion.discountCapAmount === null
        ? raw
        : Math.min(raw, promotion.discountCapAmount);
    }
    case "fixed":
      return promotion.value;
    case "free_shipping":
      return 0;
  }
}

/**
 * Hitung kutipan final dari data server. Input `lines` HARUS sudah divalidasi terhadap
 * katalog (harga & varian dibaca ulang dari DB), jadi klien tidak bisa menyelundupkan harga.
 */
export function buildQuote(input: {
  lines: readonly PricingLine[];
  promotion?: Promotion | null;
  shipping?: ShippingSelection | null;
  at: Date;
}): QuoteTotals {
  const lines = input.lines.map((l) => ({
    ...l,
    quantity: Math.trunc(l.quantity),
    unitPriceAmount: Math.trunc(l.unitPriceAmount),
  }));
  if (lines.length === 0) {
    throw new AppError("CART_EMPTY", "Keranjang masih kosong.", { status: 422 });
  }
  const subtotalAmount = lines.reduce((acc, l) => acc + lineSubtotal(l), 0);

  const evaluation = evaluatePromotion(input.promotion ?? null, lines, { at: input.at });
  let discountAmount = 0;
  let freeShippingApplied = false;
  const eligibleLines =
    input.promotion && evaluation.eligible
      ? lines.filter((l) => isLineInScope(l, input.promotion?.scope ?? null))
      : [];

  if (input.promotion && evaluation.eligible) {
    const promo = input.promotion;
    if (promo.kind === "free_shipping") {
      freeShippingApplied = true;
    } else {
      const eligibleSubtotal = eligibleLines.reduce((acc, l) => acc + lineSubtotal(l), 0);
      discountAmount = clampDiscount(computeDiscount(promo, eligibleSubtotal), subtotalAmount);
    }
  }

  // Alokasi diskon per baris (dipakai untuk menghitung refundable per baris).
  const lineDiscounts: Record<string, number> = {};
  if (discountAmount > 0 && eligibleLines.length > 0) {
    const weights = eligibleLines.map((l) => lineSubtotal(l));
    const allocated = allocateByWeights(discountAmount, weights);
    eligibleLines.forEach((l, i) => {
      lineDiscounts[l.lineId] = allocated[i] ?? 0;
    });
  }

  const baseShipping = input.shipping ? Math.max(0, Math.trunc(input.shipping.costAmount)) : 0;
  const shippingAmount = freeShippingApplied ? 0 : baseShipping;
  const feeAmount = 0; // PPN ritel sudah termasuk harga tampil (tax-inclusive) - lihat docs/pricing-rules.md
  const totalAmount = Math.max(0, subtotalAmount - discountAmount) + shippingAmount + feeAmount;

  return {
    currency: DEFAULT_CURRENCY,
    subtotalAmount,
    discountAmount,
    shippingAmount,
    feeAmount,
    totalAmount,
    lineDiscounts,
    promotionId: input.promotion && evaluation.eligible ? input.promotion.id : null,
    promotionCode: input.promotion && evaluation.eligible ? input.promotion.code : null,
    promotionLabel: input.promotion && evaluation.eligible ? input.promotion.label : null,
    freeShippingApplied,
  };
}

function timeOf(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** Shipping quote kedaluwarsa -> minta ulang, jangan diam-diam memakai tarif lama. */
export function assertShippingQuoteFresh(shipping: ShippingSelection | null, at: Date): void {
  if (!shipping) {
    throw new AppError("VALIDATION_FAILED", "Pilih metode pengiriman terlebih dahulu.", {
      status: 422,
    });
  }
  // Nilai bisa datang dari JSONB (string ISO) maupun dari adapter (Date); keduanya sah.
  const expiresAtMs = timeOf(shipping.expiresAt);
  if (expiresAtMs !== null && expiresAtMs < at.getTime()) {
    throw new AppError(
      "SHIPPING_QUOTE_EXPIRED",
      "Estimasi ongkir sudah kedaluwarsa. Muat ulang tarif.",
      {
        status: 409,
        details: { serviceCode: shipping.serviceCode },
      },
    );
  }
}

/** AT-03: bila angka yang dikirim klien berbeda dengan hasil server, server yang menang. */
export function reconcileClientTotals(
  client: { totalAmount?: number } | null | undefined,
  server: QuoteTotals,
): {
  totalAmount: number;
  mismatch: boolean;
} {
  if (!client || typeof client.totalAmount !== "number")
    return { totalAmount: server.totalAmount, mismatch: false };
  const clientValue = Math.trunc(client.totalAmount);
  return { totalAmount: server.totalAmount, mismatch: clientValue !== server.totalAmount };
}
