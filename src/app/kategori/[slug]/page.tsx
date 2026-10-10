import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCategoryBySlug, listCategories } from "@/server/services/catalog.service";
import { ListingView } from "@/components/commerce/listing-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return { title: `Kategori ${slug}` };
  return {
    title: category.name,
    description:
      category.description ??
      `Daftar produk ${category.name} dengan harga Rupiah dan pengiriman dari Jakarta.`,
    alternates: { canonical: `/kategori/${category.slug}` },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, rawParams] = await Promise.all([params, searchParams]);
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();
  return (
    <ListingView
      basePath={`/kategori/${category.slug}`}
      rawParams={rawParams}
      categorySlug={category.slug}
      heading={category.name}
      intro={category.description ?? undefined}
    />
  );
}
