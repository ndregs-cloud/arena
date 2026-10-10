export const DEV_TOTP_SECRET: string;
export const ALNUM: string;
export const DEMO_CUSTOMER: { email: string; name: string; phone: string };
export function makeReference(prefix: string, at?: Date): string;
export function hashPassword(password: string): string;
export function encryptSecret(plain: string, authSecret: string): string;
export function pgArray(values: readonly unknown[]): string;
export function svgProductImage(input: {
  name: string;
  brand: string;
  index: number;
  tone?: number;
}): string;
export function svgBannerImage(input: { title: string; subtitle: string; tone?: number }): string;
export function writePlaceholders(input: {
  root: string;
  products: Array<{
    slug: string;
    name: string;
    brand: string;
    tone?: number;
    imageCount?: number;
    variants: unknown[];
  }>;
  banners: Array<{ file: string; title: string; subtitle: string; tone?: number }>;
}): Array<{ slug: string; url: string; position: number; alt: string }>;
export interface SeedOptions {
  password: string;
  authSecret: string;
  catalog: { CATEGORIES: unknown[]; PRODUCTS: unknown[]; ATTRIBUTE_DEFINITIONS: unknown[] };
  imagesRoot?: string;
  includeDemoOrders?: boolean;
  now?: Date;
}
export interface SeedSummary {
  users: Array<{ role: string; email: string }>;
  products: number;
  variants: number;
  orders: number;
  images: number;
}
export function seedAll(db: unknown, options: SeedOptions): Promise<SeedSummary>;
