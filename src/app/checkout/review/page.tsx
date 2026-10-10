import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CheckboxRow } from "@/components/ui/field";
import { formatIDR, formatDate } from "@/lib/format";
import { getRequestContext } from "@/server/context";
import { getCartView } from "@/server/services/cart.service";
import { evaluateCheckoutReadiness } from "@/server/services/checkout.service";
import { loadCurrentPolicy } from "@/server/services/policy.service";
import { CartTotals } from "@/components/commerce/cart-totals";
import { placeOrderAction } from "@/app/actions/checkout";

export const metadata: Metadata = {
  title: "Checkout - tinjau",
  robots: { index: false, follow: false },
};

export default async function ReviewStep({
  searchParams,
}: {
  searchParams: Promise<{ pesan?: string }>;
}) {
  const notice = (await searchParams).pesan;
  const ctx = await getRequestContext();
  const [view, readiness, policy] = await Promise.all([
    getCartView(ctx),
    evaluateCheckoutReadiness(ctx),
    loadCurrentPolicy("syarat"),
  ]);
  const address = view.draft.address;
  const shipping = view.draft.shipping;
  const payment = view.draft.payment;

  return (
    <div className="flex flex-col gap-4">
      {notice ? <Alert tone="danger">{notice}</Alert> : null}
      {!readiness.ready ? (
        <Alert tone="warning" title="Belum bisa dibuat">
          <ul className="list-disc pl-5">
            {readiness.blockers.map((blocker) => (
              <li key={`${blocker.step}-${blocker.message}`}>
                <Link href={`/checkout/${blocker.step}`} className="underline decoration-dotted">
                  {blocker.message}
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Periksa pesanan"
          subtitle="Harga & ongkir dihitung ulang dari data server saat tombol ditekan."
        />
        <dl className="grid gap-4 text-[14px] sm:grid-cols-2">
          <div>
            <dt className="label">Dikirim kepada</dt>
            <dd className="mt-1 text-ink-soft">
              {address ? (
                <>
                  <strong className="text-ink">{address.fullName}</strong> · {address.phone}
                  <br />
                  {address.street}
                  {address.landmark ? `, ${address.landmark}` : ""}
                  <br />
                  {address.district}, {address.city}, {address.province} {address.postalCode}
                </>
              ) : (
                "Belum diisi"
              )}
            </dd>
          </div>
          <div>
            <dt className="label">Kontak</dt>
            <dd className="mt-1 text-ink-soft">
              {view.draft.contact?.email ?? ctx.user?.email ?? "-"}
              <br />
              {view.draft.contact?.phone ?? "-"}
            </dd>
          </div>
          <div>
            <dt className="label">Pengiriman</dt>
            <dd className="mt-1 text-ink-soft">
              {shipping ? (
                <>
                  {shipping.serviceName} · {shipping.estimateLabel} ·{" "}
                  {shipping.costAmount === 0 ? "gratis" : formatIDR(shipping.costAmount)}
                  {shipping.isSimulated ? " (simulasi)" : ""}
                </>
              ) : (
                "Belum dipilih"
              )}
            </dd>
          </div>
          <div>
            <dt className="label">Pembayaran</dt>
            <dd className="mt-1 text-ink-soft">
              {payment
                ? `${payment.methodName} - status menunggu konfirmasi provider`
                : "Belum dipilih"}
            </dd>
          </div>
        </dl>

        <ul className="mt-4 divide-y divide-border border-t border-border pt-2 text-[14px]">
          {view.lines.map((line) => (
            <li key={line.cartItemId} className="flex items-start justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="font-semibold text-ink">{line.productName}</span>
                <span className="block text-[13px] text-secondary">
                  {line.variantLabel} · {line.quantity} × {formatIDR(line.unitPriceAmount)}
                </span>
              </span>
              <span className="tnum shrink-0 font-semibold">{formatIDR(line.lineTotalAmount)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-border pt-4">
          <CartTotals view={view} />
        </div>
      </Card>

      <Card>
        <form action={placeOrderAction} className="flex flex-col gap-4">
          <div>
            <p className="label">Syarat &amp; ketentuan</p>
            <p className="hint mt-1">
              Versi berlaku:{" "}
              {policy
                ? `${policy.title} (v${policy.version}, diperbarui ${formatDate(policy.effectiveAt)})`
                : "versi terbaru"}
            </p>
            {policy ? (
              <details className="mt-2 rounded-card border border-border bg-canvas p-3">
                <summary className="cursor-pointer text-[14px] font-semibold">
                  Baca syarat &amp; ketentuan
                </summary>
                <div className="mt-2 whitespace-pre-line text-[13px] leading-[20px] text-ink-soft">
                  {policy.body}
                </div>
              </details>
            ) : null}
          </div>
          <CheckboxRow
            id="terms"
            name="terms"
            required
            label={
              <>
                Saya menyetujui syarat &amp; ketentuan, kebijakan pengiriman, dan kebijakan retur.
              </>
            }
            hint="Tanpa persetujuan, pesanan tidak dapat dibuat."
          />
          <CheckboxRow
            id="marketing"
            name="marketing"
            label="Kirimi saya info promo berkala"
            hint="Bisa dimatikan kapan pun di halaman akun. Consent dicatat dengan versi kebijakan."
            value="on"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/checkout/pembayaran" className="link text-[14px]">
              ← Ubah pembayaran
            </Link>
            <Button type="submit" disabled={!readiness.ready}>
              Buat pesanan &amp; bayar
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
