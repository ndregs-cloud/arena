import type { CartView } from "@/server/services/cart.service";
import { formatIDR } from "@/lib/format";

/** Rincian total. Semua angka berasal dari CartTotals hasil hitung service (AT-03). */
export function CartTotals({
  view,
  showShipping = true,
}: {
  view: CartView;
  showShipping?: boolean;
}) {
  const { totals, shippingQuote } = view;
  return (
    <dl className="flex flex-col gap-2 text-[14px]">
      <div className="flex justify-between gap-3">
        <dt className="text-secondary">Subtotal ({view.itemCount} item)</dt>
        <dd className="tnum font-semibold">{formatIDR(totals.subtotalAmount)}</dd>
      </div>
      {totals.discountAmount > 0 ? (
        <div className="flex justify-between gap-3">
          <dt className="text-secondary">
            Diskon{view.promotion ? ` · ${view.promotion.label}` : ""}
          </dt>
          <dd className="tnum font-semibold text-success">−{formatIDR(totals.discountAmount)}</dd>
        </div>
      ) : null}
      {showShipping ? (
        <div className="flex justify-between gap-3">
          <dt className="text-secondary">
            Ongkir{shippingQuote ? ` · ${shippingQuote.serviceName}` : ""}
          </dt>
          <dd className="tnum font-semibold">
            {shippingQuote ? (
              totals.shippingAmount === 0 ? (
                "Gratis"
              ) : (
                formatIDR(totals.shippingAmount)
              )
            ) : (
              <span className="text-secondary">dihitung setelah alamat</span>
            )}
          </dd>
        </div>
      ) : null}
      {totals.feeAmount > 0 ? (
        <div className="flex justify-between gap-3">
          <dt className="text-secondary">Biaya layanan</dt>
          <dd className="tnum font-semibold">{formatIDR(totals.feeAmount)}</dd>
        </div>
      ) : null}
      <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
        <dt className="font-semibold text-ink">Total bayar</dt>
        <dd className="tnum text-[20px] font-bold leading-[28px] text-ink">
          {formatIDR(totals.totalAmount)}
        </dd>
      </div>
    </dl>
  );
}
