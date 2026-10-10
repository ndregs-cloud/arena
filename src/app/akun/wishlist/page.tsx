import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomerPage } from "@/server/context";
import { listWishlist } from "@/server/services/account.service";
import { toggleWishlistAction } from "@/app/actions/account";
import { formatIDR } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/state";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Wishlist", robots: { index: false, follow: false } };

export default async function WishlistPage() {
  const ctx = await requireCustomerPage("/akun/wishlist");
  const rows = await listWishlist(ctx);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Wishlist kosong"
        description="Simpan produk yang ingin dipantau harganya. Wishlist bukan reservasi - stok tetap dihitung saat checkout."
        action={<ButtonLink href="/cari">Cari produk</ButtonLink>}
        icon="☆"
      />
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((item) => (
        <li key={item.productId}>
          <article className="card card-pad flex h-full flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <Link
                href={`/produk/${item.slug}`}
                className="font-semibold text-ink hover:text-brand hover:underline"
              >
                {item.name}
              </Link>
              {item.status !== "published" ? (
                <Badge tone="warning">Tidak tersedia</Badge>
              ) : item.inStock ? (
                <Badge tone="success">Tersedia</Badge>
              ) : (
                <Badge tone="danger">Stok habis</Badge>
              )}
            </div>
            <p className="tnum text-[15px] font-bold">{formatIDR(item.priceAmount)}</p>
            <div className="mt-auto flex flex-wrap gap-2 pt-1">
              <ButtonLink size="sm" variant="secondary" href={`/produk/${item.slug}`}>
                Buka produk
              </ButtonLink>
              <form action={toggleWishlistAction}>
                <input type="hidden" name="productId" value={item.productId} />
                <input type="hidden" name="slug" value={item.slug} />
                <input type="hidden" name="variantId" value={item.variantId ?? ""} />
                <button
                  type="submit"
                  className="min-h-[36px] rounded-control px-3 text-[13px] font-semibold text-danger hover:bg-danger-soft"
                >
                  Hapus
                </button>
              </form>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
