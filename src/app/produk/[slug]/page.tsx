import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ProductDetail, ProductVariant } from "@/domain/catalog";
import { computeStockView } from "@/domain/catalog";
import { formatIDR, formatDate, formatNumber, formatRating } from "@/lib/format";
import { getRequestContext } from "@/server/context";
import {
  getProductBySlug,
  listRelatedProducts,
  listReviews,
} from "@/server/services/catalog.service";
import { loadStockForVariants } from "@/server/services/inventory.service";
import { toggleWishlist, wishlistProductIds } from "@/server/services/account.service";
import { ProductGrid } from "@/components/commerce/product-grid";
import { ProductGallery } from "@/components/commerce/product-gallery";
import { AddToCartForm } from "@/components/commerce/add-to-cart-form";
import { PriceBlock } from "@/components/ui/price";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { createReviewAction, toggleWishlistAction } from "@/app/actions/account";

/**
 * Halaman produk (desain §9). Semua harga & stok dibaca dari service pada saat render;
 * pemilihan varian lewat query string supaya bisa di-share dan berfungsi tanpa JavaScript.
 */

type Search = Record<string, string | string[] | undefined>;

function pickVariant(
  detail: ProductDetail,
  search: Search,
): { variant: ProductVariant | null; selections: Record<string, string> } {
  const active = detail.variants.filter((item) => item.isActive && !item.isDeleted);
  const byId = search.var;
  if (typeof byId === "string") {
    const found = active.find((item) => item.id === byId);
    if (found) return { variant: found, selections: { ...found.options } };
  }
  const selections: Record<string, string> = {};
  for (const attribute of detail.attributesByVariant) {
    const value = search[attribute.code];
    if (typeof value === "string" && value.length > 0) selections[attribute.code] = value;
  }
  const match = active.find((item) =>
    Object.entries(selections).every(([code, value]) => item.options[code] === value),
  );
  if (match) return { variant: match, selections };
  const first = active[0] ?? null;
  return { variant: first, selections: first ? { ...first.options } : {} };
}

function hrefFor(
  detail: ProductDetail,
  variant: ProductVariant | null,
  attributeCode: string,
  value: string,
  selections: Record<string, string>,
): string {
  const next = { ...selections, [attributeCode]: value };
  const target =
    detail.variants.find(
      (item) =>
        item.isActive &&
        !item.isDeleted &&
        Object.entries(next).every(([code, chosen]) =>
          code === attributeCode ? item.options[code] === chosen : item.options[code] === chosen,
        ),
    ) ?? variant;
  const params = new URLSearchParams();
  for (const [code, chosen] of Object.entries(next)) if (chosen) params.set(code, chosen);
  if (target) params.set("var", target.id);
  const qs = params.toString();
  return `/produk/${detail.slug}${qs ? `?${qs}` : ""}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const ctx = await getRequestContext({ createCartToken: false });
  const product = await getProductBySlug(slug, ctx);
  if (!product) return { title: "Produk tidak ditemukan" };
  const canonical = `/produk/${product.canonicalSlug ?? product.slug}`;
  return {
    title: product.seoTitle ?? product.name,
    description: product.seoDescription ?? product.summary,
    alternates: { canonical },
    openGraph: {
      title: product.seoTitle ?? product.name,
      description: product.seoDescription ?? product.summary,
      images: product.primaryMediaUrl ? [{ url: product.primaryMediaUrl }] : undefined,
    },
  };
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Search>;
}) {
  const [{ slug }, rawSearch] = await Promise.all([params, searchParams]);
  const ctx = await getRequestContext();
  const product = await getProductBySlug(slug, ctx);
  // Produk tak dikenal = 404 sungguhan (bukan redirect soft) supaya mesin pencari
  // tidak mengindeks halaman kosong - Blueprint §12.3 / [R8].
  if (!product) notFound();

  const { variant, selections } = pickVariant(product, rawSearch);
  const stockMap = await loadStockForVariants(product.variants.map((item) => item.id));
  const stock = variant ? (stockMap.get(variant.id) ?? null) : null;
  const stockView = computeStockView(variant, stock?.available ?? 0);
  const mediaForVariant = variant
    ? product.media.filter(
        (item) =>
          !item.variantId || item.variantId === variant.id || variant.mediaIds.includes(item.id),
      )
    : product.media;
  const gallery = mediaForVariant.length > 0 ? mediaForVariant : product.media;
  const reviews = await listReviews(product.id);
  const related = await listRelatedProducts(product.id, product.categoryId, 4);
  const maxQuantity = stockView.maxPurchaseQuantity ?? variant?.maxQuantityPerOrder ?? 10;
  const soldOut = stockView.state === "out_of_stock";
  const isDraft = product.status !== "published";
  const wishlisted =
    ctx.user && !ctx.isStaff ? (await wishlistProductIds(ctx)).includes(product.id) : false;
  const notice = typeof rawSearch.pesan === "string" ? rawSearch.pesan : null;
  const reviewSent = rawSearch.ulasan === "terkirim";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.seoDescription ?? product.summary,
    sku: variant?.sku ?? product.variants[0]?.sku ?? undefined,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    image: gallery.map((item) => item.url),
    offers: {
      "@type": "Offer",
      priceCurrency: "IDR",
      price: variant?.priceAmount ?? product.minPriceAmount,
      availability: soldOut ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/produk/${product.slug}`,
    },
    aggregateRating:
      product.reviewCount > 0 && product.ratingAverage
        ? {
            "@type": "AggregateRating",
            ratingValue: product.ratingAverage,
            reviewCount: product.reviewCount,
            bestRating: 5,
          }
        : undefined,
  };

  return (
    <div className="page section">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav aria-label="Breadcrumb" className="mb-4 text-[13px] text-secondary">
        <Link href="/" className="hover:underline">
          Beranda
        </Link>
        <span aria-hidden="true"> › </span>
        <Link href={`/kategori/${product.categorySlug}`} className="hover:underline">
          {product.categoryName}
        </Link>
        <span aria-hidden="true"> › </span>
        <span className="text-ink-soft">{product.name}</span>
      </nav>

      {isDraft ? (
        <Alert tone="warning" title="Pratinjau staf" className="mb-4">
          Produk berstatus <strong>{product.status}</strong> dan tidak tampil untuk pelanggan.
          Tautan beli dinonaktifkan sampai produk dipublikasikan.
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="danger" className="mb-4">
          {notice}
        </Alert>
      ) : null}
      {reviewSent ? (
        <Alert tone="success" className="mb-4" title="Ulasan diterima">
          Ulasan Anda masuk antrean moderasi dan tampil setelah disetujui.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,55%)_minmax(0,1fr)] lg:gap-10">
        <ProductGallery media={gallery} alt={product.name} />

        <div className="flex min-w-0 flex-col gap-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {product.brand ? <Badge tone="neutral">{product.brand}</Badge> : null}
              {product.isNew ? <Badge tone="brand">Baru</Badge> : null}
              {product.hasPromotion ? <Badge tone="danger">Sedang promo</Badge> : null}
            </div>
            <h1 className="mt-2 text-[24px] leading-[32px] md:text-[32px] md:leading-[40px]">
              {product.name}
            </h1>
            <p className="mt-2 text-[15px] leading-[23px] text-ink-soft">{product.summary}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-[14px] text-secondary">
                {product.reviewCount > 0
                  ? `${formatRating(product.ratingAverage ?? 0)} dari 5 · ${formatNumber(product.reviewCount)} ulasan`
                  : "Belum ada ulasan"}
              </span>
              {product.soldQuantity > 0 ? (
                <span className="tnum text-[13px] text-secondary">
                  {formatNumber(product.soldQuantity)} terjual
                </span>
              ) : null}
            </div>
          </div>

          <Card>
            <PriceBlock
              amount={variant?.priceAmount ?? product.minPriceAmount}
              compareAt={variant?.compareAtAmount ?? product.compareAtAmount}
              size="lg"
            />
            <p className="mt-2 text-[13px] text-secondary">
              Harga sudah termasuk PPN. Ongkir dihitung di checkout sesuai alamat &amp; berat paket.
            </p>
            <p className="mt-3 flex flex-wrap items-center gap-2 text-[14px]">
              <StockBadge state={stockView.state} label={stockView.label} />
              {stock?.trackInventory ? (
                <span className="tnum text-secondary">SKU {stock.sku}</span>
              ) : null}
            </p>
          </Card>

          {product.attributesByVariant.length > 0 ? (
            <div className="flex flex-col gap-4">
              {product.attributesByVariant.map((attribute) => {
                const values = [
                  ...new Set(
                    product.variants
                      .filter((item) => item.isActive && !item.isDeleted)
                      .map((item) => item.options[attribute.code])
                      .filter((value): value is string => Boolean(value)),
                  ),
                ];
                if (values.length === 0) return null;
                return (
                  <fieldset key={attribute.code} className="border-0 p-0">
                    <legend className="label mb-2 p-0">
                      {attribute.label}
                      {selections[attribute.code] ? (
                        <span className="ml-2 font-normal text-secondary">
                          Dipilih: {selections[attribute.code]}
                        </span>
                      ) : null}
                    </legend>
                    <ul className="flex flex-wrap gap-2">
                      {values.map((value) => {
                        const selected = selections[attribute.code] === value;
                        return (
                          <li key={value}>
                            <Link
                              href={hrefFor(product, variant, attribute.code, value, selections)}
                              aria-current={selected ? "true" : undefined}
                              className={
                                selected
                                  ? "inline-flex min-h-[44px] items-center gap-2 rounded-control border-2 border-brand bg-brand-soft px-3 text-[14px] font-semibold text-brand"
                                  : "inline-flex min-h-[44px] items-center gap-2 rounded-control border border-border bg-surface px-3 text-[14px] font-semibold hover:border-brand"
                              }
                            >
                              {attribute.presentation === "swatch" ? (
                                <span
                                  aria-hidden="true"
                                  className={`size-4 rounded-pill border border-ink/20 bg-${value.toLowerCase().replace(/\s+/g, "-")}`}
                                  style={{ background: swatchColor(value) }}
                                />
                              ) : null}
                              {value}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                );
              })}
            </div>
          ) : (
            <p className="text-[14px] text-secondary">
              Produk ini satu varian:{" "}
              <strong className="text-ink">{variant?.label || "Standar"}</strong>.
            </p>
          )}

          {variant ? (
            <AddToCartForm
              variantId={variant.id}
              min={variant.minQuantityPerOrder}
              max={soldOut ? variant.minQuantityPerOrder : maxQuantity}
              disabled={isDraft || soldOut || !variant.isActive}
              disabledReason={
                isDraft
                  ? "Produk belum dipublikasikan."
                  : soldOut
                    ? "Stok varian ini habis."
                    : !variant.isActive
                      ? "Varian ini sedang tidak dijual."
                      : null
              }
              variantLabel={variant.label || "produk"}
            />
          ) : (
            <Alert tone="warning" title="Varian belum tersedia">
              Produk ini belum punya varian aktif. Hubungi dukungan bila Anda memerlukan bantuan.
            </Alert>
          )}

          <ul className="grid gap-2 text-[14px] text-ink-soft sm:grid-cols-2">
            <li className="rounded-card border border-border bg-surface px-3 py-2">
              ✓ Pengiriman dari Jakarta, kurir simulasi (reg / yes / kgo)
            </li>
            <li className="rounded-card border border-border bg-surface px-3 py-2">
              ✓ Retur 14 hari sejak barang diterima
            </li>
            {product.warranty ? (
              <li className="rounded-card border border-border bg-surface px-3 py-2">
                ✓ Garansi: {product.warranty}
              </li>
            ) : null}
            <li className="rounded-card border border-border bg-surface px-3 py-2">
              {ctx.user ? (
                <WishlistForm
                  productId={product.id}
                  slug={product.slug}
                  variantId={variant?.id ?? null}
                  active={Boolean(wishlisted)}
                />
              ) : (
                <Link className="link font-semibold" href="/masuk?setelah=/akun/wishlist">
                  Masuk untuk menyimpan ke wishlist
                </Link>
              )}
            </li>
          </ul>

          <details className="card card-pad" open>
            <summary className="cursor-pointer text-[16px] font-semibold">
              Spesifikasi &amp; isi paket
            </summary>
            <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {Object.entries(product.attributes).map(([key, value]) => (
                <div
                  key={key}
                  className="flex justify-between gap-3 border-b border-border/70 pb-1 text-[14px]"
                >
                  <dt className="text-secondary">{key}</dt>
                  <dd className="text-right font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            {product.packageContents.length > 0 ? (
              <>
                <p className="label mt-4">Isi kemasan</p>
                <ul className="mt-1 list-disc pl-5 text-[14px] text-ink-soft">
                  {product.packageContents.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {product.careInstructions ? (
              <>
                <p className="label mt-4">Perawatan</p>
                <p className="mt-1 text-[14px] text-ink-soft">{product.careInstructions}</p>
              </>
            ) : null}
          </details>

          <section className="card card-pad">
            <CardHeader
              title="Deskripsi"
              subtitle={`Dipublikasikan ${product.publishedAt ? formatDate(product.publishedAt) : "baru saja"}`}
            />
            <div className="whitespace-pre-line text-[15px] leading-[24px] text-ink-soft">
              {product.description}
            </div>
          </section>
        </div>
      </div>

      <section className="section" aria-labelledby="ulasan">
        <CardHeader
          title={
            product.reviewCount > 0
              ? `Ulasan pelanggan (${product.reviewCount})`
              : "Ulasan pelanggan"
          }
          subtitle={
            product.reviewCount > 0
              ? `Rata-rata ${formatRating(product.ratingAverage ?? 0)} dari 5 - hanya pembeli terverifikasi yang dapat menulis.`
              : "Belum ada ulasan untuk produk ini."
          }
          id="ulasan"
        />
        {reviews.length === 0 ? (
          <EmptyState
            title="Belum ada ulasan"
            description="Jadilah yang pertama menilai produk ini setelah pesanan Anda selesai dikirim."
            icon="★"
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {reviews.slice(0, 6).map((review) => (
              <li key={review.id}>
                <Card className="h-full">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold text-ink">{review.title}</p>
                    <span
                      className="tnum text-[13px] text-warning"
                      aria-label={`Nilai ${review.rating} dari 5`}
                    >
                      {"★".repeat(review.rating)}
                      <span className="text-border">{"★".repeat(5 - review.rating)}</span>
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] text-secondary">
                    {review.authorName} · {formatDate(review.createdAt)}
                    {review.isVerifiedPurchase ? " · pembelian terverifikasi" : ""}
                    {review.variantLabel ? ` · varian ${review.variantLabel}` : ""}
                  </p>
                  <p className="mt-2 text-[14px] leading-[21px] text-ink-soft">{review.body}</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
        {ctx.user && !ctx.isStaff ? (
          <form
            action={createReviewAction}
            className="card card-pad mt-4 grid gap-3 md:grid-cols-2"
          >
            <input type="hidden" name="productId" value={product.id} />
            <input type="hidden" name="slug" value={product.slug} />
            <input type="hidden" name="variantLabel" value={variant?.label ?? ""} />
            <div className="md:col-span-2">
              <h3 className="text-[16px]">Tulis ulasan</h3>
              <p className="hint mt-1">
                Ulasan hanya dapat ditulis untuk pesanan yang sudah diterima, satu ulasan per item.
                Moderator meninjau sebelum tayang.
              </p>
            </div>
            <label className="flex flex-col gap-1">
              <span className="label">Nilai (1-5)</span>
              <select name="rating" defaultValue="5" className="control">
                {[5, 4, 3, 2, 1].map((value) => (
                  <option key={value} value={value}>
                    {value} bintang
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">Judul ulasan</span>
              <input
                name="title"
                required
                minLength={3}
                maxLength={80}
                className="control"
                placeholder="Mis. Bunyi jernih untuk panggilan"
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="label">Cerita singkat</span>
              <textarea
                name="body"
                maxLength={1200}
                rows={3}
                className="control"
                placeholder="Apa yang sesuai / tidak sesuai harapan?"
              />
            </label>
            <div className="md:col-span-2">
              <button
                type="submit"
                className="min-h-[44px] rounded-control bg-brand px-4 font-semibold text-white hover:bg-brand-hover"
              >
                Kirim ulasan
              </button>
            </div>
          </form>
        ) : null}
      </section>

      {related.length > 0 ? (
        <section className="section" aria-labelledby="related">
          <h2 id="related" className="mb-4">
            Produk terkait
          </h2>
          <ProductGrid items={related} priorityCount={0} />
        </section>
      ) : null}
    </div>
  );
}

function StockBadge({ state, label }: { state: string; label: string }) {
  const tone =
    state === "out_of_stock"
      ? "danger"
      : state === "low_stock"
        ? "warning"
        : state === "not_tracked"
          ? "neutral"
          : "success";
  return <Badge tone={tone as "danger" | "warning" | "neutral" | "success"}>{label}</Badge>;
}

/** Warna swatch ilustratif untuk label teks; label tetap ditulis di sampingnya (status bukan hanya warna). */
function swatchColor(value: string): string {
  const map: Record<string, string> = {
    hitam: "#1b1b1f",
    onyx: "#1b1b1f",
    putih: "#f6f7f9",
    cloud: "#f0efe9",
    abu: "#8b9099",
    navy: "#1f355c",
    biru: "#2f6fdb",
    hijau: "#2f8f5b",
    krem: "#e7d9c6",
    coklat: "#7a5230",
    merah: "#c2413a",
  };
  return map[value.toLowerCase()] ?? "#cfd6e4";
}

function WishlistForm({
  productId,
  slug,
  variantId,
  active,
}: {
  productId: string;
  slug: string;
  variantId: string | null;
  active: boolean;
}) {
  return (
    <form action={toggleWishlistAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="variantId" value={variantId ?? ""} />
      <button
        type="submit"
        className="min-h-[36px] rounded-control border border-border bg-surface px-3 text-[13px] font-semibold text-ink-soft hover:border-brand hover:text-brand"
      >
        {active ? "★ Tersimpan di wishlist" : "☆ Simpan ke wishlist"}
      </button>
    </form>
  );
}
