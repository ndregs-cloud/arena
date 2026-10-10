import type { Metadata } from "next";
import Link from "next/link";
import { getRequestContext } from "@/server/context";
import { formatIDR } from "@/lib/format";
import { removeCartLineAction, updateCartLineAction } from "@/app/actions/cart";
import { getCartView } from "@/server/services/cart.service";
import { CartTotals } from "@/components/commerce/cart-totals";
import { CouponForm } from "@/components/commerce/coupon-form";
import { QuantityInput } from "@/components/ui/quantity-input";
import { EmptyState } from "@/components/ui/state";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Keranjang",
  description: "Periksa jumlah, harga Rupiah, dan kode promo sebelum lanjut ke checkout.",
  robots: { index: false, follow: false },
};

export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<{ pesan?: string }>;
}) {
  const notice = (await searchParams).pesan;
  const ctx = await getRequestContext();
  const view = await getCartView(ctx);

  return (
    <div className="page section">
      <h1>Keranjang</h1>
      {notice ? (
        <Alert tone="danger" className="mt-3">
          {notice}
        </Alert>
      ) : null}
      {view.isEmpty ? (
        <div className="mt-6">
          <EmptyState
            title="Keranjang masih kosong"
            description="Tambahkan produk dari katalog; harga dan stok akan dihitung ulang saat checkout."
            action={<ButtonLink href="/cari">Mulai belanja</ButtonLink>}
            icon="🛒"
          />
        </div>
      ) : (
        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <ul className="flex flex-col gap-3">
            {view.lines.map((line) => (
              <li key={line.cartItemId}>
                <Card className="flex gap-4">
                  <div className="flex w-full gap-4">
                    <Link
                      href={`/produk/${line.productSlug}`}
                      className="shrink-0"
                      aria-label={line.productName}
                    >
                      {line.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={line.imageUrl}
                          alt={line.imageAlt ?? line.productName}
                          width={96}
                          height={120}
                          className="aspect-[4/5] w-24 rounded-tile border border-border bg-canvas object-cover"
                        />
                      ) : (
                        <div className="aspect-[4/5] w-24 rounded-tile border border-border bg-canvas" />
                      )}
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div>
                        <Link
                          href={`/produk/${line.productSlug}`}
                          className="text-[16px] font-semibold text-ink hover:text-brand hover:underline"
                        >
                          {line.productName}
                        </Link>
                        <p className="text-[13px] text-secondary">
                          {line.variantLabel} · SKU {line.sku}
                        </p>
                      </div>
                      <p className="tnum text-[14px] text-ink-soft">
                        {formatIDR(line.unitPriceAmount)} <span className="text-secondary">×</span>{" "}
                        {line.quantity} = <strong>{formatIDR(line.lineTotalAmount)}</strong>
                      </p>
                      {line.available <= 0 && line.trackInventory ? (
                        <Alert>Stok habis - keluarkan item untuk melanjutkan checkout.</Alert>
                      ) : null}
                      {line.available > 0 && line.quantity > line.available ? (
                        <Alert>
                          Jumlah melebihi stok tersedia ({line.available}); akan disesuaikan saat
                          pesanan dibuat.
                        </Alert>
                      ) : null}
                      <div className="mt-auto flex flex-wrap items-end gap-3">
                        <form action={updateCartLineAction} className="flex items-end gap-2">
                          <input type="hidden" name="cartItemId" value={line.cartItemId} />
                          <div className="flex flex-col gap-1">
                            <span className="label">Jumlah</span>
                            <QuantityInput
                              id={`qty-${line.cartItemId}`}
                              name="quantity"
                              value={line.quantity}
                              min={1}
                              max={Math.max(1, line.maxQuantity)}
                              label={`jumlah ${line.productName}`}
                            />
                          </div>
                          <button
                            type="submit"
                            className="min-h-[44px] rounded-control border border-border bg-surface px-3 text-[13px] font-semibold hover:bg-canvas"
                          >
                            Perbarui
                          </button>
                        </form>
                        <form action={removeCartLineAction}>
                          <input type="hidden" name="cartItemId" value={line.cartItemId} />
                          <button
                            type="submit"
                            className="min-h-[44px] rounded-control px-3 text-[13px] font-semibold text-danger hover:bg-danger-soft"
                          >
                            Hapus
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
            <Card>
              <CardHeader
                title="Ringkasan"
                subtitle={`Berat total ${view.weightGrams} g (dipakai untuk ongkir)`}
              />
              <CartTotals view={view} />
              <div className="mt-4 flex flex-col gap-3">
                <CouponForm
                  code={view.promotion?.code ?? null}
                  freeShippingApplied={view.totals.freeShippingApplied}
                />
                <ButtonLink href="/checkout/alamat" className="w-full">
                  Lanjut ke checkout
                </ButtonLink>
                <Link href="/cari" className="link text-center text-[13px]">
                  Lanjut belanja
                </Link>
              </div>
            </Card>
            {view.shippingQuote ? (
              <Alert tone="info" title={`Ongkir: ${view.shippingQuote.serviceName}`}>
                Estimasi {view.shippingQuote.estimateLabel}. Ubah di langkah pengiriman.
              </Alert>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}
