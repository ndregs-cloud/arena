import type { CurrencyCode } from "@/domain/money";
import { assertAmount } from "@/domain/money";

/** Catalog: produk, varian/SKU, media, atribut, status publikasi (Blueprint §5.1). */

export const PRODUCT_STATUSES = ["draft", "published", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export interface ProductMedia {
  id: string;
  url: string;
  altText: string;
  position: number;
  width: number;
  height: number;
  isPrimary: boolean;
  variantId?: string | null;
}

export interface VariantOptionValues {
  [attributeCode: string]: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  /** Label gabungan opsi, contoh "Cloud / 42". */
  label: string;
  options: VariantOptionValues;
  priceAmount: number;
  compareAtAmount: number | null;
  currency: CurrencyCode;
  /** null = stok tidak dilacak (mis. pre-order). */
  onHand: number | null;
  reserved: number;
  safetyStock: number;
  lowStockThreshold: number;
  maxQuantityPerOrder: number | null;
  minQuantityPerOrder: number;
  isActive: boolean;
  mediaIds: string[];
  isDeleted: boolean;
}

export interface AttributeDefinition {
  code: string;
  label: string;
  /** swatch = warna (wajib punya label teks), choice = chip, numeric = angka. */
  presentation: "swatch" | "choice" | "numeric";
  position: number;
  isRequired: boolean;
}

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
  path: string[];
  productCount: number;
  attributeCodes: string[];
}

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  summary: string;
  status: ProductStatus;
  brand: string | null;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  minPriceAmount: number;
  maxPriceAmount: number;
  compareAtAmount: number | null;
  currency: CurrencyCode;
  primaryMediaUrl: string | null;
  primaryMediaAlt: string | null;
  availableQuantity: number;
  totalVariantQuantity: number;
  ratingAverage: number | null;
  reviewCount: number;
  soldQuantity: number;
  isNew: boolean;
  hasPromotion: boolean;
  stockState: StockState;
  publishedAt: Date | null;
  updatedAt: Date;
}

export interface ProductDetail extends ProductSummary {
  description: string;
  attributes: Record<string, string>;
  careInstructions: string | null;
  packageContents: string[];
  warranty: string | null;
  media: ProductMedia[];
  variants: ProductVariant[];
  attributesByVariant: AttributeDefinition[];
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalSlug: string | null;
}

/** Status stok yang boleh ditampilkan; jangan menjanjikan stok yang belum tervalidasi (desain §9.1). */
export const STOCK_STATES = [
  "in_stock",
  "low_stock",
  "out_of_stock",
  "not_tracked",
  "archive",
] as const;
export type StockState = (typeof STOCK_STATES)[number];

export interface StockView {
  state: StockState;
  /** Teks label - status tidak boleh hanya warna (desain §16.1). */
  label: string;
  quantity: number | null;
  maxPurchaseQuantity: number | null;
}

export function computeStockView(variant: ProductVariant | null, availability: number): StockView {
  if (!variant) {
    return {
      state: "not_tracked",
      label: "Pilih varian untuk melihat stok",
      quantity: null,
      maxPurchaseQuantity: null,
    };
  }
  if (variant.onHand === null) {
    return {
      state: "not_tracked",
      label: "Sesuai pesanan (pre-order)",
      quantity: null,
      maxPurchaseQuantity: variant.maxQuantityPerOrder ?? 10,
    };
  }
  if (availability <= 0) {
    return { state: "out_of_stock", label: "Stok habis", quantity: 0, maxPurchaseQuantity: 0 };
  }
  const low = availability <= variant.lowStockThreshold;
  return {
    state: low ? "low_stock" : "in_stock",
    // Label faktual: tanpa urgensi palsu (desain §6.3 & §16.1 - status tidak boleh hanya warna, dan tidak memaksa).
    label: low ? `Stok terbatas (${availability})` : "Stok tersedia",
    quantity: availability,
    maxPurchaseQuantity: Math.min(availability, variant.maxQuantityPerOrder ?? availability),
  };
}

/**
 * AT-01: produk draft/archived tidak boleh tampil publik.
 * Preview hanya untuk aktor dengan izin catalog.read (diputuskan di service, bukan di UI).
 */
export function isPubliclyVisible(status: ProductStatus, opts: { canPreview: boolean }): boolean {
  if (status === "published") return true;
  return opts.canPreview;
}

export function requiresVariantSelection(product: Pick<ProductDetail, "variants">): boolean {
  return product.variants.filter((v) => v.isActive && !v.isDeleted).length > 1;
}

export function activeVariants(variants: readonly ProductVariant[]): ProductVariant[] {
  return variants.filter((v) => v.isActive && !v.isDeleted);
}

export function findVariant(
  product: Pick<ProductDetail, "variants">,
  variantId: string | null | undefined,
) {
  if (!variantId) return null;
  return activeVariants(product.variants).find((v) => v.id === variantId) ?? null;
}

export function variantPriceAmount(variant: ProductVariant): number {
  return assertAmount(variant.priceAmount);
}

export function discountPercentage(current: number, compareAt: number | null): number | null {
  if (compareAt === null || compareAt <= current) return null;
  assertAmount(current);
  assertAmount(compareAt);
  return Math.round(((compareAt - current) / compareAt) * 100);
}

export function primaryMedia(media: readonly ProductMedia[]): ProductMedia | null {
  if (media.length === 0) return null;
  const sorted = [...media].sort((a, b) => a.position - b.position);
  return sorted.find((m) => m.isPrimary) ?? sorted[0] ?? null;
}

/** Media yang relevan untuk varian terpilih; fallback ke seluruh media (CAT-02: koheren). */
export function mediaForVariant(
  media: readonly ProductMedia[],
  variantId: string | null,
): ProductMedia[] {
  const sorted = [...media].sort((a, b) => a.position - b.position);
  if (!variantId) return sorted;
  const matched = sorted.filter((m) => m.variantId === variantId);
  return matched.length > 0 ? [...matched, ...sorted.filter((m) => !m.variantId)] : sorted;
}

export function deriveSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export const SEO_LIMITS = { title: 60, description: 160 } as const;

export function describeVariantSelection(variant: ProductVariant | null): string {
  if (!variant) return "Varian belum dipilih";
  const entries = Object.entries(variant.options);
  if (entries.length === 0) return variant.label;
  return entries.map(([k, v]) => `${v}`).join(" / ");
}
