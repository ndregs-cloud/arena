import Link from "next/link";
import { BRAND, SIMULATION_NOTE } from "@/lib/brand";
import {
  listFeaturedProducts,
  listNewProducts,
  listTopCategories,
} from "@/server/services/catalog.service";
import { ProductGrid } from "@/components/commerce/product-grid";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { formatNumber } from "@/lib/format";

/**
 * Beranda (desain §8): hero satu pesan + CTA, kategori, unggulan, terbaru. Tidak ada
 * countdown palsu atau klaim "hampir habis" yang tidak berasal dari stok.
 */
export default async function HomePage() {
  const [featured, newest, categories] = await Promise.all([
    listFeaturedProducts(8),
    listNewProducts(4),
    listTopCategories(8),
  ]);

  return (
    <div>
      <section className="border-b border-border bg-surface">
        <div className="page section grid items-center gap-6 md:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="text-[13px] font-bold uppercase tracking-wide text-brand">{BRAND.name}</p>
            <h1 className="mt-2 max-w-[18ch]">{BRAND.tagline}</h1>
            <p className="mt-3 max-w-prose text-[16px] leading-[24px] text-ink-soft">
              Harga dalam Rupiah, ongkir dihitung dari alamat dan berat paket, dan status pesanan
              bisa dilacak tanpa masuk akun.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href="/cari"
                className="min-h-[44px] inline-flex items-center rounded-control bg-brand px-5 font-semibold text-white hover:bg-brand-hover"
              >
                Mulai belanja
              </Link>
              <Link
                href="/cari?sort=newest"
                className="min-h-[44px] inline-flex items-center rounded-control border border-border bg-surface px-5 font-semibold text-ink hover:bg-canvas"
              >
                Lihat produk baru
              </Link>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-secondary">
              <li>✓ Retur 14 hari setelah barang diterima</li>
              <li>✓ Invoice &amp; status pembayaran real-time</li>
              <li>✓ Data pribadi minimized (UU PDP)</li>
            </ul>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/img/banners/hero-1.svg"
            alt="Koleksi elektronik NOVA STORE"
            width={1200}
            height={675}
            className="aspect-[16/9] w-full rounded-sheet border border-border object-cover"
          />
        </div>
      </section>

      <div className="page">
        <Alert tone="warning" className="mt-6" title="Lingkungan demo">
          {SIMULATION_NOTE}
        </Alert>
      </div>

      <section className="page section" aria-labelledby="kategori">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 id="kategori">Belanja per kategori</h2>
          <Link href="/cari" className="link text-[14px] font-semibold">
            Semua kategori →
          </Link>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {categories.map((category) => (
            <li key={category.id}>
              <Link
                href={`/kategori/${category.slug}`}
                className="group flex h-full flex-col gap-2 rounded-card border border-border bg-surface p-3 hover:border-brand hover:shadow-card"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/img/categories/${category.slug}.svg`}
                  alt=""
                  width={480}
                  height={300}
                  loading="lazy"
                  className="aspect-[8/5] w-full rounded-tile bg-canvas object-cover"
                />
                <span className="text-[15px] font-semibold text-ink group-hover:text-brand">
                  {category.name}
                </span>
                <span className="tnum text-[12px] text-secondary">
                  {formatNumber(category.productCount)} produk
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="page section" aria-labelledby="unggulan">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 id="unggulan">Produk unggulan</h2>
          <Link href="/cari?sort=popular" className="link text-[14px] font-semibold">
            Lihat semua →
          </Link>
        </div>
        <ProductGrid items={featured} priorityCount={2} />
      </section>

      <section className="page section" aria-labelledby="terbaru">
        <h2 id="terbaru" className="mb-4">
          Baru masuk
        </h2>
        <ProductGrid items={newest} priorityCount={0} />
      </section>

      <section className="page section" aria-labelledby="janji">
        <h2 id="janji" className="mb-4">
          Cara kami bekerja
        </h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {[
            {
              title: "Harga jujur di keranjang",
              body: "Semua total dihitung ulang dari database saat checkout. Angka dari peramban tidak pernah dipercaya.",
            },
            {
              title: "Stok dikunci 30 menit",
              body: "Saat pesanan dibuat, stok dipesan untuk Anda sampai batas bayar; kalau lewat, stok dilepas otomatis.",
            },
            {
              title: "Retur & refund tertata",
              body: "Ajukan dari halaman pesanan, lampirkan foto bila diminta, dan pantau statusnya sampai dana kembali.",
            },
          ].map((item) => (
            <li key={item.title}>
              <Card className="h-full">
                <h3 className="text-[16px]">{item.title}</h3>
                <p className="mt-1 text-[14px] leading-[21px] text-secondary">{item.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
