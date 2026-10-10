import type { MetadataRoute } from "next";
import { env } from "@/platform/env";
import { listCategories, listProducts } from "@/server/services/catalog.service";

/**
 * Sitemap: halaman komersial + kategori + produk terpublikasi.
 * Area akun/checkout/admin dan halaman simulasi sengaja tidak dimasukkan.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.appUrl.replace(/\/$/, "");
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/cari`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/bantuan`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/kebijakan/pengiriman`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/kebijakan/retur`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/syarat`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/privasi`, changeFrequency: "yearly", priority: 0.2 },
  ];

  try {
    const [categories, products] = await Promise.all([
      listCategories(),
      listProducts({ sort: "newest", perPage: 500, includeUnpublished: false }),
    ]);
    return [
      ...staticPages,
      ...categories.map((category) => ({
        url: `${base}/kategori/${category.slug}`,
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
      ...products.items.map((product) => ({
        url: `${base}/produk/${product.slug}`,
        lastModified: product.updatedAt,
        changeFrequency: "daily" as const,
        priority: 0.8,
      })),
    ];
  } catch {
    // Sitemap tidak boleh membuat build/runtime gagal saat basis data belum siap.
    return staticPages;
  }
}
