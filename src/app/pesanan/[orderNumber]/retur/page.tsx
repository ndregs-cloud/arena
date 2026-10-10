import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCustomerPage } from "@/server/context";
import { checkReturnEligibility } from "@/server/services/return.service";
import { formatIDR, formatDate } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, TextArea } from "@/components/ui/field";
import { QuantityInput } from "@/components/ui/quantity-input";
import { createReturnAction } from "@/app/actions/order";

export const metadata: Metadata = {
  title: "Ajukan retur",
  robots: { index: false, follow: false },
};

export default async function CreateReturnPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;
  const ctx = await requireCustomerPage("/pesanan/[orderNumber]/retur");
  if (!ctx.user) redirect(`/masuk?setelah=${encodeURIComponent(`/pesanan/${orderNumber}/retur`)}`);
  const data = await checkReturnEligibility(ctx, orderNumber).catch(() => null);
  if (!data) notFound();
  const { order, eligibility, reasons, returnWindowDays } = data;

  return (
    <div className="page section">
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-secondary">
        <Link href="/akun/pesanan" className="hover:underline">
          Pesanan saya
        </Link>
        <span aria-hidden="true"> › </span>
        <Link href={`/pesanan/${orderNumber}`} className="hover:underline">
          {orderNumber}
        </Link>
        <span aria-hidden="true"> › </span>
        <span className="text-ink-soft">Ajukan retur</span>
      </nav>

      <h1 className="text-[24px] leading-[32px]">Ajukan retur - {orderNumber}</h1>
      <p className="mt-1 text-[14px] text-secondary">
        Batas pengajuan {returnWindowDays} hari
        {eligibility.windowEndsAt ? ` sampai ${formatDate(eligibility.windowEndsAt)}` : ""}. Ongkir
        ikut dikembalikan hanya bila kesalahan ada di sisi toko.
      </p>

      {!eligibility.eligible ? (
        <Alert tone="warning" className="mt-4" title="Retur belum dapat diajukan">
          <ul className="list-disc pl-5">
            {eligibility.messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card className="mt-4">
        <CardHeader
          title="Pilih item dan jumlahnya"
          subtitle="Nilai yang diajukan dihitung ulang di server (termasuk porsi diskon kupon)."
        />
        <form action={createReturnAction} className="flex flex-col gap-4">
          <input type="hidden" name="orderNumber" value={orderNumber} />
          <ul className="flex flex-col gap-3">
            {order.lines.map((line, index) => {
              const lineEligibility = eligibility.lines.find(
                (entry) => entry.orderItemId === line.orderItemId,
              );
              const remaining = lineEligibility?.returnableQuantity ?? 0;
              const blocked = !lineEligibility?.eligible || remaining <= 0 || !line.isReturnable;
              return (
                <li key={line.orderItemId} className="rounded-card border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-ink">{line.nameSnapshot}</p>
                      <p className="text-[13px] text-secondary">
                        {line.variantLabelSnapshot} · dipesan {line.quantity} · bisa diretur{" "}
                        {Math.max(0, remaining)}
                      </p>
                      <p className="tnum mt-1 text-[13px] text-ink-soft">
                        Nilai baris {formatIDR(line.lineTotalAmount)}
                        {line.discountAllocatedAmount > 0
                          ? ` (termasuk diskon ${formatIDR(line.discountAllocatedAmount)})`
                          : ""}
                      </p>
                    </div>
                    {blocked ? (
                      <p className="text-[13px] font-semibold text-danger">
                        {lineEligibility?.message ??
                          (line.isReturnable
                            ? "Sudah tidak dapat diretur"
                            : "Item ini tidak dapat diretur")}
                      </p>
                    ) : (
                      <QuantityInput
                        id={`ret-${line.orderItemId}`}
                        name={`qty:${line.orderItemId}`}
                        min={0}
                        max={remaining}
                        value={remaining === line.quantity ? line.quantity : 0}
                        label={`jumlah retur ${line.nameSnapshot}`}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Alasan retur"
              htmlFor="reasonCode"
              required
              hint="Alasan tertentu mewajibkan foto."
            >
              <select
                id="reasonCode"
                name="reasonCode"
                className="control"
                defaultValue={
                  reasons.find((reason) => !reason.requiresPhoto)?.code ?? reasons[0]?.code
                }
              >
                {reasons.map((reason) => (
                  <option key={reason.code} value={reason.code}>
                    {reason.label}
                    {reason.requiresPhoto ? " (wajib foto)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Penyelesaian yang diminta" htmlFor="resolution" required>
              <select id="resolution" name="resolution" className="control" defaultValue="refund">
                <option value="refund">Refund ke metode pembayaran</option>
                <option value="exchange">Tukar barang</option>
                <option value="store_credit">Kredit toko</option>
                <option value="none">Lainnya / cukup dicatat</option>
              </select>
            </Field>
            <Field
              label="Keterangan"
              htmlFor="description"
              required
              className="sm:col-span-2"
              hint="Jelaskan kondisi barang dan masalah yang dialami."
            >
              <TextArea id="description" name="description" required rows={4} maxLength={1200} />
            </Field>
            <Field
              label="Refensi foto"
              htmlFor="photos"
              className="sm:col-span-2"
              hint="Pisahkan dengan koma. Unggahan file aktif setelah penyimpanan media (S3/Supabase Storage) dikonfigurasi."
            >
              <input
                id="photos"
                name="photos"
                className="control"
                placeholder="retur/2026/…jpg"
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href={`/pesanan/${orderNumber}`} className="link text-[14px]">
              ← Kembali ke pesanan
            </Link>
            <Button type="submit" disabled={!eligibility.eligible}>
              Kirim pengajuan retur
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
