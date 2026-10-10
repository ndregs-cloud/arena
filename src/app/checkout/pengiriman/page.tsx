import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { RadioCard } from "@/components/ui/field";
import { formatIDR } from "@/lib/format";
import { getRequestContext } from "@/server/context";
import { getShippingOptions } from "@/server/services/shipping.service";
import { chooseShippingAction } from "@/app/actions/checkout";

export const metadata: Metadata = {
  title: "Checkout - pengiriman",
  robots: { index: false, follow: false },
};

export default async function ShippingStep({
  searchParams,
}: {
  searchParams: Promise<{ pesan?: string }>;
}) {
  const notice = (await searchParams).pesan;
  const ctx = await getRequestContext();
  const result = await getShippingOptions(ctx);
  const selected = result.options.find((option) => option.selected);

  return (
    <Card>
      <CardHeader
        title="Metode pengiriman"
        subtitle={`Berat terhitung ${result.weightGrams} g · sumber tarif: ${result.source === "simulated" ? "adapter simulasi" : result.source === "provider" ? "provider kurir" : "tabel manual"}`}
      />
      {notice ? (
        <Alert tone="danger" className="mb-3">
          {notice}
        </Alert>
      ) : null}
      {result.warning ? (
        <Alert tone="warning" className="mb-3">
          {result.warning}
        </Alert>
      ) : null}
      {result.requiresAddress ? (
        <Alert tone="warning" title="Alamat belum lengkap" className="mb-3">
          Ongkir membutuhkan alamat tujuan.{" "}
          <Link href="/checkout/alamat" className="link font-semibold">
            Lengkapi alamat →
          </Link>
        </Alert>
      ) : null}

      {result.options.length === 0 ? (
        <Alert tone="danger" title="Tarif tidak tersedia">
          Tidak ada opsi pengiriman untuk alamat/berat ini. Ubah alamat atau kurangi berat paket,
          lalu muat ulang halaman.
        </Alert>
      ) : (
        <form action={chooseShippingAction} className="flex flex-col gap-3">
          {result.options.map((option, index) => (
            <RadioCard
              key={`${option.carrierCode}-${option.serviceCode}`}
              id={`ship-${option.serviceCode}`}
              name="service"
              value={`${option.carrierCode}|${option.serviceCode}`}
              defaultChecked={option.selected || (!selected && index === 0)}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {option.serviceName}
                  {option.isSimulated ? <Badge tone="warning">Simulasi</Badge> : null}
                </span>
              }
              description={`${option.estimateLabel}${option.carrierCode ? ` · ${option.carrierCode}` : ""}`}
              meta={option.costAmount === 0 ? "Gratis" : formatIDR(option.costAmount)}
            />
          ))}
          <p className="hint">{result.quoteNote}</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/checkout/alamat" className="link text-[14px]">
              ← Ubah alamat
            </Link>
            <Button type="submit" disabled={result.options.length === 0}>
              Lanjut ke pembayaran
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
