import type { Metadata } from "next";
import { ListingView } from "@/components/commerce/listing-view";

export const metadata: Metadata = {
  title: "Cari produk",
  description: "Telusuri katalog dengan filter merek, harga, warna, ukuran, dan penilaian.",
  alternates: { canonical: "/cari" },
  robots: { index: true, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  return (
    <ListingView
      basePath="/cari"
      rawParams={params}
      heading={q ? `Hasil pencarian: ${q}` : "Semua produk"}
      categorySlug={null}
    />
  );
}
