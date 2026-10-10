import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { getRequestContext } from "@/server/context";
import { getCartView } from "@/server/services/cart.service";
import { listTopCategories } from "@/server/services/catalog.service";
import { formatNumber } from "@/lib/format";
import { MobileNav } from "@/components/commerce/mobile-nav";

/**
 * Header storefront: pencarian, kategori, keranjang (jumlah item dari service, bukan klien),
 * dan menu akun. Menu mobile adalah disclosure klien; tanpa JS daftar kategori tetap tampil.
 */
export async function SiteHeader() {
  const [ctx, categories] = await Promise.all([
    getRequestContext(),
    listTopCategories().catch(() => []),
  ]);
  const cart = await getCartView(ctx).catch(() => null);
  const itemCount = cart?.itemCount ?? 0;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="page flex min-h-[64px] items-center gap-3 py-2">
        <button
          id="menu-mobile-open"
          type="button"
          aria-controls="menu-mobile"
          className="flex size-11 items-center justify-center rounded-control border border-border text-ink md:hidden"
        >
          <span aria-hidden="true">☰</span>
          <span className="sr-only">Buka menu navigasi</span>
        </button>
        <Link href="/" className="flex items-baseline gap-2 rounded-control px-1 py-1">
          <span className="text-[20px] font-extrabold tracking-tight text-ink">{BRAND.name}</span>
          <span className="hidden text-[12px] text-secondary sm:inline">
            elektronik & gaya hidup
          </span>
        </Link>

        <form
          action="/cari"
          method="get"
          role="search"
          className="ml-auto hidden min-w-0 flex-1 items-center gap-2 md:flex md:max-w-[520px]"
        >
          <label htmlFor="site-search" className="sr-only">
            Cari produk
          </label>
          <input
            id="site-search"
            name="q"
            type="search"
            placeholder="Cari produk, merek, atau SKU"
            className="control"
            autoComplete="off"
          />
          <button
            type="submit"
            className="min-h-[44px] rounded-control bg-brand px-4 text-[15px] font-semibold text-white hover:bg-brand-hover"
          >
            Cari
          </button>
        </form>

        <nav aria-label="Akun dan keranjang" className="ml-auto flex items-center gap-1 md:ml-0">
          {ctx.user ? (
            <Link
              href="/akun/pesanan"
              className="hidden min-h-[44px] items-center rounded-control px-3 text-[14px] font-semibold text-ink-soft hover:bg-canvas sm:inline-flex"
            >
              {ctx.isStaff ? <span>Pesanan</span> : <span>Pesanan saya</span>}
            </Link>
          ) : (
            <Link
              href="/masuk"
              className="hidden min-h-[44px] items-center rounded-control px-3 text-[14px] font-semibold text-ink-soft hover:bg-canvas sm:inline-flex"
            >
              Masuk
            </Link>
          )}
          {ctx.isStaff ? (
            <Link
              href="/admin"
              className="hidden min-h-[44px] items-center rounded-control border border-brand/40 px-3 text-[14px] font-semibold text-brand hover:bg-brand-soft md:inline-flex"
            >
              Admin
            </Link>
          ) : null}
          <Link
            href="/keranjang"
            className="relative inline-flex min-h-[44px] items-center gap-2 rounded-control border border-border px-3 text-[14px] font-semibold text-ink hover:bg-canvas"
            aria-label={`Keranjang, ${itemCount} item`}
          >
            <span aria-hidden="true">🛒</span>
            <span className="hidden sm:inline">Keranjang</span>
            {itemCount > 0 ? (
              <span className="tnum absolute -right-1 -top-1 min-w-[20px] rounded-pill bg-brand px-1 text-center text-[11px] font-bold leading-[18px] text-white">
                {formatNumber(itemCount)}
              </span>
            ) : null}
          </Link>
        </nav>
      </div>

      <div className="page hidden md:block">
        <nav aria-label="Kategori utama" className="flex gap-1 overflow-x-auto pb-2">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/kategori/${category.slug}`}
              className="whitespace-nowrap rounded-pill border border-border px-3 py-1.5 text-[13px] font-semibold text-ink-soft hover:border-brand hover:text-brand"
            >
              {category.name}
            </Link>
          ))}
          <Link
            href="/cari"
            className="whitespace-nowrap rounded-pill border border-transparent px-3 py-1.5 text-[13px] font-semibold text-brand hover:bg-brand-soft"
          >
            Semua produk →
          </Link>
        </nav>
      </div>

      <MobileNav
        categories={categories.map((c) => ({ href: `/kategori/${c.slug}`, label: c.name }))}
        isStaff={ctx.isStaff}
        signedIn={Boolean(ctx.user)}
      />
    </header>
  );
}
