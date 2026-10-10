import { z } from "zod";

/**
 * Validasi di boundary (Blueprint §10.4). Skema yang sama dipakai server action dan form UI
 * supaya pesan error konsisten dan bisa diasosiasikan ke field.
 */

export const POSTCODE_RE = /^\d{5}$/;
/** Format ponsel Indonesia: 08xx (10-13 digit) atau +62 (11-15 digit). */
export const ID_PHONE_RE = /^(?:08\d{8,11}|\+628\d{8,13})$/;

export function normalizePhone(input: string): string {
  const trimmed = input.trim().replace(/[\s().-]/g, "");
  if (trimmed.startsWith("62") && !trimmed.startsWith("+62")) return `+${trimmed}`;
  return trimmed;
}

export function isValidIdPhone(input: string): boolean {
  return ID_PHONE_RE.test(normalizePhone(input));
}

export function isValidPostalCode(input: string): boolean {
  return POSTCODE_RE.test(input.trim());
}

export const idSchema = z.string().uuid("ID tidak valid");

export const emailSchema = z
  .string()
  .trim()
  .min(5, "Email terlalu pendek")
  .max(254, "Email terlalu panjang")
  .email("Masukkan email yang valid, contoh nama@surel.id");

export const passwordSchema = z
  .string()
  .min(10, "Kata sandi minimal 10 karakter")
  .max(128, "Kata sandi maksimal 128 karakter")
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), "Kombinasikan huruf dan angka");

export const quantitySchema = z.coerce
  .number({ message: "Jumlah harus berupa angka" })
  .int("Jumlah harus bilangan bulat")
  .min(1, "Minimal 1")
  .max(999, "Maksimal 999 per baris");

export const amountSchema = z.coerce
  .number({ message: "Nominal harus angka dalam Rupiah" })
  .int("Gunakan Rupiah utuh, tanpa sen")
  .min(0, "Nominal tidak boleh negatif");

export const addressSchema = z
  .object({
    fullName: z.string().trim().min(3, "Isi nama penerima.").max(120, "Nama terlalu panjang"),
    phone: z
      .string()
      .trim()
      .refine(isValidIdPhone, "Masukkan nomor ponsel yang valid, misalnya 08xxxxxxxxxx."),
    province: z.string().trim().min(2, "Pilih provinsi."),
    city: z.string().trim().min(2, "Isi kota/kabupaten."),
    district: z.string().trim().min(1, "Isi kecamatan."),
    postalCode: z.string().trim().refine(isValidPostalCode, "Kode pos terdiri dari 5 angka."),
    street: z
      .string()
      .trim()
      .min(8, "Tulis alamat jalan lebih detail (jalan, nomor rumah, RT/RW).")
      .max(400, "Alamat terlalu panjang"),
    landmark: z.string().trim().max(200, "Patokan terlalu panjang").optional().or(z.literal("")),
    label: z.enum(["rumah", "kantor", "lainnya"]).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();
export type AddressInput = z.infer<typeof addressSchema>;

export const checkoutContactSchema = z
  .object({
    email: emailSchema,
    phone: z
      .string()
      .trim()
      .refine(isValidIdPhone, "Masukkan nomor ponsel yang valid, misalnya 08xxxxxxxxxx."),
    saveAsAccount: z.boolean().optional(),
  })
  .strict();
export type CheckoutContactInput = z.infer<typeof checkoutContactSchema>;

export const cartAddSchema = z
  .object({
    variantId: idSchema,
    quantity: quantitySchema,
  })
  .strict();

export const cartUpdateSchema = z
  .object({
    cartItemId: idSchema,
    quantity: quantitySchema,
  })
  .strict();

export const couponCodeSchema = z
  .string()
  .trim()
  .min(3, "Kode promo minimal 3 karakter")
  .max(32, "Kode promo maksimal 32 karakter")
  .regex(/^[A-Z0-9_-]+$/i, "Kode promo hanya berisi huruf, angka, strip, atau underscore.");

export const shippingChoiceSchema = z
  .object({
    serviceCode: z.string().trim().min(1, "Pilih metode pengiriman."),
    carrierCode: z.string().trim().min(1, "Pilih metode pengiriman."),
  })
  .strict();

export const paymentChoiceSchema = z
  .object({
    methodCode: z.enum(["sim_va", "sim_qris", "sim_card"]),
    termsAccepted: z.literal(true, "Setujui syarat & kebijakan sebelum membuat pesanan."),
    marketingConsent: z.boolean().optional(),
    policyVersion: z.string().trim().min(1, "Versi kebijakan wajib tercatat."),
  })
  .strict();

export const loginSchema = z
  .object({
    identifier: z.string().trim().min(3, "Isi email Anda."),
    password: z.string().min(1, "Isi kata sandi."),
    totpCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Kode MFA 6 angka")
      .optional()
      .or(z.literal("")),
  })
  .strict();

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(3, "Isi nama lengkap.").max(120, "Nama terlalu panjang"),
    email: emailSchema,
    password: passwordSchema,
    phone: z
      .string()
      .trim()
      .refine(isValidIdPhone, "Masukkan nomor ponsel yang valid, misalnya 08xxxxxxxxxx."),
    marketingConsent: z.boolean().optional(),
  })
  .strict();

export const shipmentSchema = z
  .object({
    carrierCode: z.string().trim().min(2, "Pilih kurir."),
    serviceCode: z.string().trim().min(1, "Pilih layanan."),
    trackingNumber: z
      .string()
      .trim()
      .min(6, "Nomor resi minimal 6 karakter")
      .max(64, "Nomor resi terlalu panjang")
      .regex(/^[A-Za-z0-9-]+$/, "Resi hanya berisi huruf, angka, atau strip."),
    packageCount: z.coerce.number().int().min(1).max(50),
    note: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .strict();

export const inventoryAdjustmentSchema = z
  .object({
    sku: z.string().trim().min(3, "SKU minimal 3 karakter").max(64, "SKU terlalu panjang"),
    locationCode: z.string().trim().min(2, "Pilih lokasi."),
    delta: z.coerce
      .number({ message: "Perubahan stok harus angka" })
      .int("Jumlah stok harus bilangan bulat")
      .refine((v) => v !== 0, "Perubahan tidak boleh nol"),
    reason: z.enum([
      "cycle_count_variance",
      "damaged_found",
      "damaged_repaired",
      "theft_or_loss",
      "wrong_entry_fix",
      "supplier_shortage",
      "customer_return_damaged",
      "customer_return_resellable",
      "sample_or_internal_use",
    ]),
    note: z.string().trim().max(300).optional().or(z.literal("")),
  })
  .strict();

export const returnRequestSchema = z
  .object({
    orderNumber: z.string().trim().min(6, "Nomor pesanan tidak valid"),
    reasonCode: z.enum([
      "damaged_on_arrival",
      "wrong_item",
      "not_as_described",
      "size_unfit",
      "changed_mind",
      "defective",
    ]),
    description: z
      .string()
      .trim()
      .min(10, "Jelaskan kondisi barang (minimal 10 karakter).")
      .max(1500, "Penjelasan terlalu panjang"),
    resolution: z.enum(["refund", "exchange", "store_credit"]),
    lines: z
      .array(
        z.object({
          orderItemId: z.string().uuid("Item pesanan tidak valid"),
          quantity: z.coerce.number().int().min(1, "Minimal 1").max(999),
        }),
      )
      .min(1, "Pilih minimal satu item."),
    photoRefs: z.array(z.string().trim().min(1)).max(6, "Maksimal 6 lampiran").optional(),
  })
  .strict();

export const productFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "Nama produk minimal 3 karakter.")
      .max(160, "Nama produk maksimal 160 karakter."),
    slug: z
      .string()
      .trim()
      .min(3, "Slug minimal 3 karakter.")
      .max(80, "Slug maksimal 80 karakter.")
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug hanya huruf kecil, angka, dan strip."),
    summary: z
      .string()
      .trim()
      .max(300, "Ringkasan maksimal 300 karakter.")
      .optional()
      .or(z.literal("")),
    description: z
      .string()
      .trim()
      .min(20, "Deskripsi minimal 20 karakter agar berguna bagi pembeli dan SEO."),
    status: z.enum(["draft", "published", "archived"]),
    categoryId: idSchema,
    brand: z.string().trim().max(80).optional().or(z.literal("")),
    careInstructions: z.string().trim().max(500).optional().or(z.literal("")),
    warranty: z.string().trim().max(300).optional().or(z.literal("")),
    priceAmount: amountSchema.refine((v) => v > 0, "Harga harus lebih dari nol"),
    compareAtAmount: amountSchema.nullable().optional(),
    seoTitle: z
      .string()
      .trim()
      .max(60, "Meta title disarankan maksimal 60 karakter.")
      .optional()
      .or(z.literal("")),
    seoDescription: z
      .string()
      .trim()
      .max(160, "Meta description disarankan maksimal 160 karakter.")
      .optional()
      .or(z.literal("")),
  })
  .strict();

export const variantFormSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .min(3, "SKU minimal 3 karakter.")
      .max(64)
      .regex(/^[A-Z0-9][A-Z0-9._-]*$/i, "SKU hanya huruf, angka, titik, strip, underscore."),
    options: z.record(z.string().trim().min(1), z.string().trim().min(1)).default({}),
    priceAmount: amountSchema.refine((v) => v > 0, "Harga varian harus lebih dari nol"),
    compareAtAmount: amountSchema.nullable().optional(),
    stockQuantity: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
    lowStockThreshold: z.coerce.number().int().min(0).max(1000).optional(),
    safetyStock: z.coerce.number().int().min(0).max(1000).optional(),
    maxQuantityPerOrder: z.coerce.number().int().min(1).max(999).nullable().optional(),
    minQuantityPerOrder: z.coerce.number().int().min(1).max(99).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const mediaFormSchema = z
  .object({
    url: z.string().trim().min(1, "Path gambar wajib diisi."),
    altText: z
      .string()
      .trim()
      .min(5, "Alt text wajib diisi (minimal 5 karakter) untuk aksesibilitas.")
      .max(200),
    position: z.coerce.number().int().min(0).max(50).optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();

export const promotionFormSchema = z
  .object({
    code: couponCodeSchema.transform((v) => v.toUpperCase()),
    label: z.string().trim().min(3, "Label promo minimal 3 karakter.").max(80),
    kind: z.enum(["percent", "fixed", "free_shipping"]),
    value: z.coerce.number().int().min(0),
    minSpendAmount: amountSchema.default(0),
    discountCapAmount: amountSchema.nullable().optional(),
    startsAt: z.string().trim().min(1, "Pilih tanggal mulai."),
    endsAt: z.string().trim().min(1, "Pilih tanggal selesai."),
    usageLimit: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    perCustomerLimit: z.coerce.number().int().min(1).max(1000).nullable().optional(),
    stackable: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.kind === "percent" && (val.value < 1 || val.value > 10_000)) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Diskon persen (basis point) antara 1 dan 10000.",
      });
    }
    if (val.kind === "fixed" && val.value <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Nominal potongan harus lebih dari nol.",
      });
    }
    if (Date.parse(val.endsAt) <= Date.parse(val.startsAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "Tanggal selesai harus setelah tanggal mulai.",
      });
    }
  });

export const reviewSchema = z
  .object({
    productId: idSchema,
    rating: z.coerce.number().int().min(1, "Pilih rating 1-5").max(5),
    title: z.string().trim().min(3, "Judul ulasan minimal 3 karakter").max(80),
    body: z.string().trim().max(2000, "Ulasan maksimal 2000 karakter").optional().or(z.literal("")),
  })
  .strict();

/** Mengubah field error zod menjadi peta per-field untuk inline error UI. */
export function flattenZodIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map((segment) => String(segment)).join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function parseOrThrow<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const message = first
      ? first.path.length === 0
        ? first.message
        : `${labelForPath(first.path.map((segment) => String(segment)))}: ${first.message}`
      : "Data tidak valid.";
    throw new Error(message);
  }
  return result.data;
}

export function labelForPath(path: ReadonlyArray<string | number>): string {
  const last = path[path.length - 1];
  if (typeof last !== "string") return "Isian";
  return FIELD_LABELS[last] ?? last;
}

const FIELD_LABELS: Record<string, string> = {
  fullName: "Nama penerima",
  phone: "Nomor ponsel",
  province: "Provinsi",
  city: "Kota/kabupaten",
  district: "Kecamatan",
  postalCode: "Kode pos",
  street: "Alamat lengkap",
  landmark: "Patokan",
  email: "Email",
  password: "Kata sandi",
  identifier: "Email",
  totpCode: "Kode MFA",
  quantity: "Jumlah",
  variantId: "Varian",
  termsAccepted: "Persyaratan",
  policyVersion: "Versi kebijakan",
  reason: "Alasan",
  reasonCode: "Alasan",
  delta: "Perubahan stok",
  sku: "SKU",
  locationCode: "Lokasi",
  trackingNumber: "Nomor resi",
  carrierCode: "Kurir",
  serviceCode: "Layanan",
  priceAmount: "Harga",
  compareAtAmount: "Harga pembanding",
  name: "Nama produk",
  slug: "Slug URL",
  description: "Deskripsi",
  summary: "Ringkasan",
  status: "Status",
  categoryId: "Kategori",
  brand: "Merek",
  altText: "Alt text",
  code: "Kode promo",
  label: "Label promo",
  kind: "Jenis promo",
  value: "Nilai diskon",
  minSpendAmount: "Minimum belanja",
  startsAt: "Tanggal mulai",
  endsAt: "Tanggal selesai",
  usageLimit: "Kuota pemakaian",
  perCustomerLimit: "Batas per pelanggan",
  rating: "Rating",
  title: "Judul ulasan",
  body: "Isi ulasan",
};

export { FIELD_LABELS };
