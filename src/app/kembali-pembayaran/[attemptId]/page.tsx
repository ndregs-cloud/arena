import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRequestContext } from "@/server/context";
import { handleBrowserReturn } from "@/server/services/payment.service";
import { ORDER_STATUS_LABELS } from "@/domain/orders";
import { formatIDR } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Kembali dari pembayaran",
  robots: { index: false, follow: false },
};

/**
 * Tujuan return URL provider. Halaman ini TIDAK mengubah status apa pun: ia hanya membaca hasil
 * rekonsiliasi (AT-05). Pelabelan "lunas" tetap menunggu konfirmasi provider lewat API/webhook.
 */
export default async function BrowserReturnPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const ctx = await getRequestContext({ createCartToken: false });
  const result = await handleBrowserReturn(ctx, attemptId).catch((error: unknown) => {
    console.error("payment.return.failed", error instanceof Error ? error.message : error);
    return null;
  });
  if (!result) notFound();
  const confirmed = result.status === "succeeded";

  return (
    <div className="page section">
      <div className="mx-auto max-w-[560px]">
        <h1 className="text-[24px] leading-[32px]">
          {confirmed ? "Pembayaran dikonfirmasi" : "Belum ada pembayaran yang dikonfirmasi"}
        </h1>
        <p className="mt-2 text-[14px] leading-[21px] text-secondary">{result.message}</p>

        <Card className="mt-4">
          <CardHeader
            title="Status saat ini"
            action={
              <StatusChip
                status={result.orderStatus}
                label={ORDER_STATUS_LABELS[result.orderStatus] ?? result.orderStatus}
              />
            }
          />
          <dl className="flex flex-col gap-2 text-[14px]">
            <div className="flex justify-between gap-3">
              <dt className="text-secondary">Attempt</dt>
              <dd className="font-semibold">{result.status}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-secondary">Pesanan</dt>
              <dd className="font-semibold">
                {ORDER_STATUS_LABELS[result.orderStatus] ?? result.orderStatus}
              </dd>
            </div>
          </dl>
          {!confirmed ? (
            <Alert tone="warning" className="mt-3" title="Tunggu konfirmasi">
              Menutup halaman ini tidak membatalkan tagihan. Selama batas bayar, Anda masih dapat
              menyelesaikan pembayaran dari halaman konfirmasi; bila sudah lewat, stok dilepas
              otomatis.
            </Alert>
          ) : (
            <Alert tone="success" className="mt-3">
              {formatIDR(0).replace("Rp 0", "")}Terima kasih - pesanan masuk antrean persiapan.
              Rincian lengkap ada di halaman pesanan.
            </Alert>
          )}
        </Card>

        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink href="/akun/pesanan" variant="secondary">
            Pesanan saya
          </ButtonLink>
          <Link
            href="/bantuan"
            className="min-h-[44px] inline-flex items-center rounded-control px-4 text-[14px] font-semibold text-brand hover:underline"
          >
            Butuh bantuan?
          </Link>
        </div>
      </div>
    </div>
  );
}
