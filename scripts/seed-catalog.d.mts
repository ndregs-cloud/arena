export interface SeedVariant {
  label: string;
  options: Record<string, string>;
  price: number;
  compare_at?: number;
  onHand: number;
  safety?: number;
  minQty?: number;
  maxQty?: number;
}
export interface SeedProduct {
  sku: string;
  name: string;
  slug: string;
  brand: string;
  category: string;
  status: "draft" | "published" | "archived" | "pending_review";
  summary: string;
  description: string;
  attributes: Record<string, unknown>;
  care?: string;
  warranty?: string;
  package?: string[];
  variants: SeedVariant[];
}
export interface SeedCategory {
  slug: string;
  name: string;
  description?: string;
  parent?: string;
  position: number;
}
export const CATEGORIES: SeedCategory[];
export const PRODUCTS: SeedProduct[];
export const ATTRIBUTE_DEFINITIONS: Array<{
  code: string;
  label: string;
  presentation: string;
  isRequired: boolean;
  position: number;
  allowedValues: unknown[];
}>;
