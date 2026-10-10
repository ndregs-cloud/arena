import Link from "next/link";
import type { ReactNode } from "react";
import type { ProductFacets } from "@/server/services/catalog.service";
import { formatIDR } from "@/lib/format";

export interface ListingParams {
  q: string;
  sort: string;
  brands: string[];
  colors: string[];
  sizes: string[];
  minPrice: number | null;
  maxPrice: number | null;
  minRating: number | null;
  inStockOnly: boolean;
}

function withOverride(
  base: ListingParams,
  key: keyof ListingParams,
  value: string | number | boolean | string[] | null,
): string {
  const params = new URLSearchParams();
  const merged = { ...base, [key]: value } as ListingParams;
  if (merged.q) params.set("q", merged.q);
  if (merged.sort && merged.sort !== "relevance") params.set("sort", merged.sort);
  for (const listKey of ["brands", "colors", "sizes"] as const) {
    const list = merged[listKey] ?? [];
    if (list.length > 0) params.set(listKey, list.join(","));
  }
  if (merged.minPrice != null) params.set("min", String(merged.minPrice));
  if (merged.maxPrice != null) params.set("max", String(merged.maxPrice));
  if (merged.minRating != null) params.set("rating", String(merged.minRating));
  if (merged.inStockOnly) params.set("stock", "1");
  params.delete("page");
  const qs = params.toString();
  return qs ? `?${qs}` : "?";
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * Panel faset: pakai tautan (bukan JS filter) supaya bisa di-share, di-back, dan di-crawl.
 * Lebar 240-280px sesuai desain §10 (listing sidebar).
 */
export function FilterPanel({
  facets,
  params,
  basePath,
}: {
  facets: ProductFacets;
  params: ListingParams;
  basePath: string;
}) {
  const activeCount =
    params.brands.length +
    params.colors.length +
    params.sizes.length +
    (params.minPrice != null ? 1 : 0) +
    (params.maxPrice != null ? 1 : 0) +
    (params.inStockOnly ? 1 : 0) +
    (params.minRating != null ? 1 : 0);

  return (
    <aside aria-label="Filter produk" className="flex flex-col gap-5 lg:w-[264px] lg:shrink-0">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[16px] font-bold">Filter</h2>
        {activeCount > 0 ? (
          <Link
            href={basePath + (params.q ? `?q=${encodeURIComponent(params.q)}` : "")}
            className="text-[13px] font-semibold text-brand hover:underline"
          >
            Hapus {activeCount} filter
          </Link>
        ) : (
          <span className="hint">Belum ada filter</span>
        )}
      </div>

      <FacetGroup title="Kategori">
        <ul className="flex flex-col gap-1">
          {facets.categories.slice(0, 12).map((category) => (
            <li key={category.id}>
              <Link
                href={`${basePath === "/cari" ? "/kategori" : basePath === "/kategori" ? "/kategori" : "/kategori"}/${category.slug}`}
                className="flex items-baseline justify-between gap-2 rounded-tile px-1 py-1 text-[14px] hover:bg-canvas"
              >
                <span className="text-ink-soft">{category.name}</span>
                <span className="tnum text-[12px] text-secondary">{category.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </FacetGroup>

      <FacetGroup title="Harga (Rupiah)">
        <ul className="flex flex-col gap-1">
          {[
            { label: "Di bawah 100rb", min: null, max: 100_000 },
            { label: "100rb - 500rb", min: 100_000, max: 500_000 },
            { label: "500rb - 2jt", min: 500_000, max: 2_000_000 },
            { label: "Di atas 2jt", min: 2_000_000, max: null },
          ].map((bucket) => {
            const selected = params.minPrice === bucket.min && params.maxPrice === bucket.max;
            return (
              <li key={bucket.label}>
                <Link
                  href={
                    basePath +
                    withOverride(params, "maxPrice", bucket.max) +
                    (bucket.min != null ? `&min=${bucket.min}` : "")
                  }
                  aria-current={selected ? "true" : undefined}
                  className={
                    selected
                      ? "flex items-center gap-2 rounded-tile bg-brand-soft px-1 py-1 text-[14px] font-semibold text-brand"
                      : "flex items-center gap-2 rounded-tile px-1 py-1 text-[14px] hover:bg-canvas"
                  }
                >
                  {selected ? (
                    <span aria-hidden="true">✓</span>
                  ) : (
                    <span aria-hidden="true" className="size-3 rounded-tile border border-border" />
                  )}
                  {bucket.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="hint mt-1">
          Rentang katalog: {formatIDR(facets.priceBounds.min || 0)} -{" "}
          {formatIDR(facets.priceBounds.max || 0)}
        </p>
      </FacetGroup>

      <FacetGroup title="Merek">
        <ul className="flex flex-col gap-1">
          {facets.brands.map((brand) => (
            <li key={brand.value}>
              <Link
                href={basePath + withOverride(params, "brands", toggle(params.brands, brand.value))}
                className="flex items-center justify-between gap-2 rounded-tile px-1 py-1 text-[14px] hover:bg-canvas"
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={
                      params.brands.includes(brand.value)
                        ? "size-3 rounded-tile bg-brand"
                        : "size-3 rounded-tile border border-border"
                    }
                  />
                  {brand.value || "Tanpa merek"}
                </span>
                <span className="tnum text-[12px] text-secondary">{brand.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </FacetGroup>

      {(facets.colors.length > 0 || facets.sizes.length > 0) && (
        <FacetGroup title="Varian">
          {facets.colors.length > 0 ? (
            <>
              <p className="label mt-1">Warna</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {facets.colors.map((color) => (
                  <li key={color.value}>
                    <Link
                      href={
                        basePath +
                        withOverride(params, "colors", toggle(params.colors, color.value))
                      }
                      className={
                        params.colors.includes(color.value)
                          ? "rounded-pill border border-brand bg-brand px-2.5 py-1 text-[13px] font-semibold text-white"
                          : "rounded-pill border border-border bg-surface px-2.5 py-1 text-[13px] hover:border-brand"
                      }
                    >
                      {color.value} · {color.count}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {facets.sizes.length > 0 ? (
            <>
              <p className="label mt-3">Ukuran</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {facets.sizes.map((size) => (
                  <li key={size.value}>
                    <Link
                      href={
                        basePath + withOverride(params, "sizes", toggle(params.sizes, size.value))
                      }
                      className={
                        params.sizes.includes(size.value)
                          ? "rounded-pill border border-brand bg-brand px-2.5 py-1 text-[13px] font-semibold text-white"
                          : "rounded-pill border border-border bg-surface px-2.5 py-1 text-[13px] hover:border-brand"
                      }
                    >
                      {size.value} · {size.count}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </FacetGroup>
      )}

      <FacetGroup title="Lainnya">
        <ul className="flex flex-col gap-1">
          <li>
            <Link
              href={basePath + withOverride(params, "inStockOnly", !params.inStockOnly)}
              className="flex items-center gap-2 rounded-tile px-1 py-1 text-[14px] hover:bg-canvas"
            >
              <span
                aria-hidden="true"
                className={
                  params.inStockOnly
                    ? "size-3 rounded-tile bg-brand"
                    : "size-3 rounded-tile border border-border"
                }
              />
              Hanya yang tersedia
            </Link>
          </li>
          {[4, 3].map((rating) => (
            <li key={rating}>
              <Link
                href={
                  basePath +
                  withOverride(params, "minRating", params.minRating === rating ? null : rating)
                }
                className="flex items-center gap-2 rounded-tile px-1 py-1 text-[14px] hover:bg-canvas"
              >
                <span
                  aria-hidden="true"
                  className={
                    params.minRating === rating
                      ? "size-3 rounded-tile bg-brand"
                      : "size-3 rounded-tile border border-border"
                  }
                />
                Nilai {rating} ke atas
              </Link>
            </li>
          ))}
        </ul>
      </FacetGroup>
    </aside>
  );
}

function FacetGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card card-pad">
      <h3 className="mb-2 text-[14px] font-bold uppercase tracking-wide text-secondary">{title}</h3>
      {children}
    </section>
  );
}

export function ActiveFilterChips({
  params,
  basePath,
}: {
  params: ListingParams;
  basePath: string;
}) {
  const chips: Array<{ label: string; href: string }> = [];
  for (const brand of params.brands)
    chips.push({
      label: `Merek: ${brand}`,
      href:
        basePath +
        withOverride(
          params,
          "brands",
          params.brands.filter((b) => b !== brand),
        ),
    });
  for (const color of params.colors)
    chips.push({
      label: `Warna: ${color}`,
      href:
        basePath +
        withOverride(
          params,
          "colors",
          params.colors.filter((c) => c !== color),
        ),
    });
  for (const size of params.sizes)
    chips.push({
      label: `Ukuran: ${size}`,
      href:
        basePath +
        withOverride(
          params,
          "sizes",
          params.sizes.filter((s) => s !== size),
        ),
    });
  if (params.minPrice != null || params.maxPrice != null)
    chips.push({
      label: "Harga terpilih",
      href:
        basePath + withOverride({ ...params, minPrice: null, maxPrice: null }, "sort", params.sort),
    });
  if (params.inStockOnly)
    chips.push({
      label: "Hanya tersedia",
      href: basePath + withOverride(params, "inStockOnly", false),
    });
  if (params.minRating != null)
    chips.push({
      label: `Nilai ${params.minRating}+`,
      href: basePath + withOverride(params, "minRating", null),
    });
  if (chips.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <Link
          key={chip.label}
          href={chip.href}
          className="inline-flex items-center gap-1 rounded-pill border border-border bg-surface px-2.5 py-1 text-[13px] hover:border-danger hover:text-danger"
        >
          {chip.label} <span aria-hidden="true">×</span>
          <span className="sr-only">hapus filter</span>
        </Link>
      ))}
    </div>
  );
}
