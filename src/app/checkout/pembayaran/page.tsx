import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { RadioCard } from "@/components/ui/field";
import { PAYMENT_METHODS } from "@/domain/payments";
import { getRequestContext } from "@/server/context";
import { getCartView } from "@/server/services/cart.service";
import { choosePaymentAction } from "@/app/actions/checkout";

export const metadata: Metadata = {
  title: "Checkout - pembayaran",
  robots: { index: false, follow: false },
};

export default async function PaymentStep({
  searchParams,
}: {
  searchParams: Promise<{ pesan?: string }>;
}) {
  const notice = (await searchParams).pesan;
  const ctx = await getRequestContext();
  const view = await getCartView(ctx);
  const selected = view.draft.payment?.methodCode;

  return (
    <Card>
      <CardHeader
        title="Metode pembayaran"
        subtitle="Pilih metode; instruksi pembayaran muncul setelah pesanan dibuat."
      />
      {notice ? (
        <Alert tone="danger" className="mb-3">
          {notice}
        </Alert>
      ) : null}
      <Alert tone="warning" className="mb-3" title="Provider belum terhubung">
        Tidak ada nomor rekening atau QRIS nyata yang diterbitkan. Data pembayaran yang Anda lihat
        adalah hasil adapter simulasi lokal.
      </Alert>
      <form action={choosePaymentAction} className="flex flex-col gap-3">
        {PAYMENT_METHODS.map((method, index) => (
          <RadioCard
            key={method.code}
            id={`pay-${method.code}`}
            name="method"
            value={method.code}
            defaultChecked={selected ? selected === method.code : index === 0}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {method.name}
                <Badge tone="warning">Simulasi</Badge>
              </span>
            }
            description={method.description}
          />
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/checkout/pengiriman" className="link text-[14px]">
            ← Ubah pengiriman
          </Link>
          <Button type="submit">Tinjau pesanan</Button>
        </div>
      </form>
    </Card>
  );
}
