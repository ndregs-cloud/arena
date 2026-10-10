import Link from "next/link";
import type { ProductSummary } from "@/domain/catalog";
import { formatIDR } from "@/lib/format";
import { PriceBlock } from "@/components/ui/price";
import { Rating, StockPill } from "@/components/commerce/rating";

/**
 * Kartu produk (desain §9.1): gambar 4:5, nama 2 baris, harga IDR, coret + persen, nilai,
 * status stok sebagai teks. Seluruh kartu adalah satu tautan - tanpa tombol "beli" palsu.
 */
export function ProductCard({
  product,
  priority = false,
}: {
  product: ProductSummary;
  priority?: boolean;
}) {
  const href = `/produk/${product.slug}`;
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface transition-shadow hover:shadow-card">
      <Link
        href={href}
        className="absolute inset-0 z-10"
        aria-label={`${product.name} - ${formatIDR(product.minPriceAmount)}`}
      >
        <span className="sr-only">Lihat detail produk</span>
      </Link>
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-canvas">
        {product.primaryMediaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.primaryMediaUrl}
            alt={product.primaryMediaAlt ?? product.name}
            width={640}
            height={800}
            loading={priority ? "eager" : "lazy"}
            className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transform-none"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-[13px] text-secondary">
            Gambar belum tersedia
          </div>
        )}
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {product.isNew ? (
            <span className="rounded-pill bg-brand px-2 py-0.5 text-[12px] font-bold text-white">
              Baru
            </span>
          ) : null}
          {product.hasPromotion ? (
            <span className="rounded-pill bg-danger px-2 py-0.5 text-[12px] font-bold text-white">
              Promo
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="text-[12px] uppercase tracking-wide text-secondary">
          {product.brand ?? product.categoryName}
        </p>
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-[21px] text-ink">
          {product.name}
        </h3>
        <PriceBlock amount={product.minPriceAmount} compareAt={product.compareAtAmount} size="sm" />
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <Rating average={product.ratingAverage} count={product.reviewCount} />
          <StockPill product={product} />
        </div>
      </div>
    </article>
  );
}
