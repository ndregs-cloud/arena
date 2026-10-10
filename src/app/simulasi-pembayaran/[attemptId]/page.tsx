import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDateTime, formatIDR } from "@/lib/format";
import { paymentProvider } from "@/platform/payment";
import { env } from "@/platform/env";
import { sandboxAttemptContext } from "@/server/services/payment.service";
import { Alert } from "@/components/ui/alert";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, StatusChip } from "@/components/ui/badge";
import { SimulationConsole } from "@/components/commerce/simulation-console";

export const metadata: Metadata = {
  title: "Halaman pembayaran (simulasi)",
  robots: { index: false, follow: false },
};

/**
 * Sandbox pembayaran lokal - meniru "hosted page" provider.
 * Hanya tersedia bila adapter aktif adalah simulasi DAN bukan produksi; tidak ada dana nyata.
 */
export default async function SimulationPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const provider = paymentProvider();
  if (process.env.NODE_ENV === "production" || !provider.isSimulated || !env.isEmbeddedDatabase)
    notFound();
  const { attemptId } = await params;
  const data = await sandboxAttemptContext(attemptId).catch(() => null);
  if (!data) notFound();
  const { attempt, trackingToken } = data;

  return (
    <div className="page section">
      <div className="mx-auto max-w-[680px]">
        <p className="text-[13px] font-bold uppercase tracking-wide text-warning">
          Hosted page simulasi
        </p>
        <h1 className="mt-1 text-[24px] leading-[32px]">Bayar pesanan {attempt.orderNumber}</h1>
        <Alert tone="warning" className="mt-3" title="Tidak ada transaksi nyata">
          {`Adapter: ${provider.displayName}. Nomor di bawah ini tidak dapat dipakai untuk transfer sungguhan.`}
        </Alert>

        <Card className="mt-4">
          <CardHeader
            title="Rincian tagihan"
            action={<StatusChip kind="payment" status={attempt.status} label={attempt.status} />}
          />
          <dl className="grid gap-2 text-[14px] sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-secondary">Nominal</dt>
              <dd className="tnum font-bold">{formatIDR(attempt.amount)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-secondary">Metode</dt>
              <dd className="font-semibold">{attempt.methodName}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-secondary">Referensi provider</dt>
              <dd className="tnum font-semibold">{attempt.providerRef ?? "belum diterbitkan"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-secondary">Dibuat</dt>
              <dd>{formatDateTime(attempt.createdAt)}</dd>
            </div>
          </dl>
          {attempt.instructions ? (
            <div className="mt-3 rounded-card border border-border bg-canvas p-3">
              <p className="label mb-1">Instruksi</p>
              <p className="whitespace-pre-line text-[14px] leading-[21px] text-ink-soft">
                {attempt.instructions}
              </p>
            </div>
          ) : null}
          {attempt.failureReason ? (
            <Alert tone="danger" className="mt-3">
              {attempt.failureReason}
            </Alert>
          ) : null}
        </Card>

        <Card className="mt-4">
          <CardHeader
            title="Konsol developer"
            subtitle="Kirim event webhook ke jalur produksi (termasuk verifikasi signature & dedup)."
            action={<Badge tone="warning">hanya dev</Badge>}
          />
          <SimulationConsole
            orderNumber={attempt.orderNumber}
            token={trackingToken}
            attemptStatus={attempt.status}
          />
        </Card>

        <div className="mt-4 flex flex-wrap gap-2 text-[14px]">
          <Link className="link" href={`/kembali-pembayaran/${attemptId}`}>
            Simulasikan kembali ke browser (return URL) →
          </Link>
          <span className="text-secondary">·</span>
          <Link
            className="link"
            href={`/konfirmasi?pesanan=${encodeURIComponent(attempt.orderNumber)}&token=${encodeURIComponent(trackingToken)}`}
          >
            Lihat status pesanan
          </Link>
        </div>
      </div>
    </div>
  );
}
