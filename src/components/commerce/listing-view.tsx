import Link from "next/link";
import { listProducts, getCategoryBySlug } from "@/server/services/catalog.service";
import type { ProductFilter } from "@/server/services/catalog.service";
import { getRequestContext } from "@/server/context";
import { ProductGrid } from "@/components/commerce/product-grid";
import {
  ActiveFilterChips,
  FilterPanel,
  type ListingParams,
} from "@/components/commerce/filter-panel";
import { Pagination } from "@/components/ui/pagination";
import { SelectInput } from "@/components/ui/field";
import { formatNumber } from "@/lib/format";

type RawParams = Record<string, string | string[] | undefined>;

function list(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(",") : value;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function numParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) ? parsed : null;
}

export function parseListingParams(raw: RawParams): ListingParams {
  return {
    q: typeof raw.q === "string" ? raw.q.slice(0, 120) : "",
    sort: typeof raw.sort === "string" ? raw.sort : "relevance",
    brands: list(raw.brands),
    colors: list(raw.colors),
    sizes: list(raw.sizes),
    minPrice: numParam(raw.min),
    maxPrice: numParam(raw.max),
    minRating: numParam(raw.rating),
    inStockOnly: raw.stock === "1",
  };
}

const SORT_OPTIONS: Array<{ value: NonNullable<ProductFilter["sort"]>; label: string }> = [
  { value: "relevance", label: "Paling relevan" },
  { value: "newest", label: "Terbaru" },
  { value: "price_asc", label: "Harga terendah" },
  { value: "price_desc", label: "Harga tertinggi" },
  { value: "popular", label: "Paling laris" },
];

/**
 * Tampilan daftar produk yang dipakai /cari dan /kategori/[slug]: faset di kiri (240-280px),
 * grid di kanan, urutkan lewat form GET (tanpa JS), paginasi tautan.
 */
export async function ListingView({
  basePath,
  rawParams,
  categorySlug,
  heading,
  intro,
}: {
  basePath: "/cari" | `/kategori/${string}`;
  rawParams: RawParams;
  categorySlug?: string | null;
  heading: string;
  intro?: string;
}) {
  const params = parseListingParams(rawParams);
  const ctx = await getRequestContext();
  const page = numParam(rawParams.page) ?? 1;
  const filter: ProductFilter = {
    q: params.q || null,
    categorySlug: categorySlug ?? null,
    brands: params.brands.length > 0 ? params.brands : undefined,
    colors: params.colors.length > 0 ? params.colors : undefined,
    sizes: params.sizes.length > 0 ? params.sizes : undefined,
    minPrice: params.minPrice,
    maxPrice: params.maxPrice,
    minRating: params.minRating,
    inStockOnly: params.inStockOnly,
    sort: (SORT_OPTIONS.find((option) => option.value === params.sort)?.value ??
      "relevance") as ProductFilter["sort"],
    page,
    perPage: 24,
    includeUnpublished: ctx.canPreviewCatalog,
  };
  const [result, category] = await Promise.all([
    listProducts(filter),
    categorySlug ? getCategoryBySlug(categorySlug) : Promise.resolve(null),
  ]);
  const searchForLinks: Record<string, string | string[] | undefined> = {
    ...(params.q ? { q: params.q } : {}),
    ...(params.sort !== "relevance" ? { sort: params.sort } : {}),
    ...(params.brands.length ? { brands: params.brands.join(",") } : {}),
    ...(params.colors.length ? { colors: params.colors.join(",") } : {}),
    ...(params.sizes.length ? { sizes: params.sizes.join(",") } : {}),
    ...(params.minPrice != null ? { min: String(params.minPrice) } : {}),
    ...(params.maxPrice != null ? { max: String(params.maxPrice) } : {}),
    ...(params.minRating != null ? { rating: String(params.minRating) } : {}),
    ...(params.inStockOnly ? { stock: "1" } : {}),
  };

  return (
    <div className="page section">
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-secondary">
        <Link href="/" className="hover:underline">
          Beranda
        </Link>
        <span aria-hidden="true"> › </span>
        <span className="text-ink-soft">
          {category?.name ?? (params.q ? `Hasil pencarian “${params.q}”` : "Semua produk")}
        </span>
      </nav>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] leading-[32px] md:text-[32px] md:leading-[40px]">{heading}</h1>
          <p className="mt-1 text-[14px] text-secondary">
            {formatNumber(result.total)} produk ditemukan
            {category && category.productCount > 0
              ? ` · ${formatNumber(category.productCount)} di kategori ini`
              : ""}
            {ctx.canPreviewCatalog ? " · termasuk draf (pratinjau staf)" : ""}
          </p>
          {intro || category?.description ? (
            <p className="mt-2 max-w-prose text-[14px] leading-[21px] text-ink-soft">
              {intro ?? category?.description}
            </p>
          ) : null}
        </div>
        <form method="get" action={basePath} className="flex items-end gap-2">
          {Object.entries(searchForLinks)
            .filter(([key]) => key !== "sort")
            .map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
          <div className="flex flex-col gap-1">
            <label htmlFor="sort" className="label">
              Urutkan
            </label>
            <SelectInput id="sort" name="sort" defaultValue={params.sort} className="min-w-[190px]">
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectInput>
          </div>
          <button
            type="submit"
            className="min-h-[44px] rounded-control border border-border bg-surface px-3 text-[14px] font-semibold hover:bg-canvas"
          >
            Terapkan
          </button>
        </form>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <FilterPanel facets={result.facets} params={params} basePath={basePath} />
        <div className="min-w-0 flex-1">
          <ActiveFilterChips params={params} basePath={basePath} />
          <ProductGrid
            items={result.items}
            emptyTitle={
              params.q
                ? `Tidak ada produk untuk “${params.q}”`
                : "Belum ada produk pada kombinasi filter ini"
            }
            emptyDescription="Coba hapus salah satu filter, atau periksa ejaan kata kunci."
          />
          <Pagination
            page={result.page}
            perPage={result.perPage}
            total={result.total}
            base={basePath}
            searchParams={searchForLinks}
          />
        </div>
      </div>
    </div>
  );
}
