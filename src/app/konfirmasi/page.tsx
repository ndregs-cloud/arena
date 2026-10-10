import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { addMinutes } from "@/domain/clock";
import { env } from "@/platform/env";
import { getRequestContext } from "@/server/context";
import { getCustomerOrder, getOrderByTrackingToken } from "@/server/services/order.service";
import { ORDER_STATUS_LABELS, type OrderSnapshot } from "@/domain/orders";
import { formatDateTime, formatIDR } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PayPanel } from "@/components/commerce/pay-panel";

export const metadata: Metadata = {
  title: "Pesanan dibuat",
  robots: { index: false, follow: false },
};

/**
 * Halaman setelah order dibuat: status "menunggu pembayaran" (bukan "lunas"), instruksi
 * pembayaran dari penyedia/adapter, dan tenggat berbasis waktu server - tanpa countdown palsu.
 */
export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ pesanan?: string; token?: string }>;
}) {
  const params = await searchParams;
  const orderNumber = typeof params.pesanan === "string" ? params.pesanan : "";
  const token = typeof params.token === "string" ? params.token : "";
  if (!orderNumber) redirect("/keranjang");

  const ctx = await getRequestContext();
  let order: OrderSnapshot | null = ctx.user
    ? await getCustomerOrder(ctx, orderNumber).catch(() => null)
    : null;
  if (!order && token) {
    const tracked = await getOrderByTrackingToken(token);
    if (tracked && tracked.order.orderNumber === orderNumber) order = tracked.order;
  }
  if (!order) {
    return (
      <div className="page section">
        <Alert tone="danger" title="Tautan konfirmasi tidak berlaku">
          Pesanan mungkin dibuat di perangkat/browser lain.{" "}
          <Link className="link font-semibold" href="/masuk?setelah=/akun/pesanan">
            Masuk ke akun Anda
          </Link>{" "}
          atau buka tautan dari email status pesanan.
        </Alert>
      </div>
    );
  }

  const deadline = order.createdAt
    ? addMinutes(new Date(order.createdAt), env.paymentTimeoutMinutes)
    : null;
  const paid = order.paymentStatus === "succeeded";
  const trackingHref = order.trackingToken
    ? `/lacak-pesanan/${order.trackingToken}`
    : `/pesanan/${order.orderNumber}`;

  return (
    <div className="page section">
      <div className="mx-auto flex max-w-[720px] flex-col gap-4">
        <div>
          <h1 className="text-[24px] leading-[32px] md:text-[32px] md:leading-[40px]">
            {paid ? "Pembayaran diterima" : "Pesanan dibuat - menunggu pembayaran"}
          </h1>
          <p className="mt-2 text-[15px] leading-[23px] text-ink-soft">
            Nomor pesanan <strong className="tnum">{order.orderNumber}</strong> ·{" "}
            {formatIDR(order.totalAmount)} · dibuat {formatDateTime(order.createdAt)}
          </p>
        </div>

        <Alert
          tone={paid ? "success" : "warning"}
          title={paid ? undefined : "Belum ada pembayaran yang dikonfirmasi"}
        >
          {paid
            ? "Status pembayaran sudah lunas menurut penyedia. Pesanan masuk antrean persiapan."
            : `Status berubah otomatis setelah penyedia mengonfirmasi. Batas bayar: ${deadline ? formatDateTime(deadline) : "lihat email"}. Setelah lewat, stok dilepas kembali.`}
        </Alert>

        <Card>
          <CardHeader
            title="Status"
            action={
              <StatusChip
                status={order.status}
                label={ORDER_STATUS_LABELS[order.status] ?? order.status}
              />
            }
          />
          <dl className="grid gap-3 text-[14px] sm:grid-cols-2">
            <div>
              <dt className="label">Pembayaran</dt>
              <dd className="mt-0.5 text-ink-soft">{order.paymentStatus}</dd>
            </div>
            <div>
              <dt className="label">Pengiriman</dt>
              <dd className="mt-0.5 text-ink-soft">{order.fulfillmentStatus}</dd>
            </div>
            <div>
              <dt className="label">Metode</dt>
              <dd className="mt-0.5 text-ink-soft">
                {order.shippingSelection?.serviceName ?? "-"}
              </dd>
            </div>
            <div>
              <dt className="label">Estimasi</dt>
              <dd className="mt-0.5 text-ink-soft">
                {order.shippingSelection?.estimateLabel ?? "-"}
              </dd>
            </div>
          </dl>
        </Card>

        {!paid ? (
          <Card>
            <CardHeader
              title="Bayar pesanan"
              subtitle="Nomor virtual account / QRIS diterbitkan oleh penyedia (di lingkungan ini: adapter simulasi)."
            />
            <PayPanel
              orderNumber={order.orderNumber}
              token={order.trackingToken}
              scenarioAllowed={env.isEmbeddedDatabase && process.env.NODE_ENV !== "production"}
            />
          </Card>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <ButtonLink href={trackingHref} variant="secondary">
            Lacak pesanan
          </ButtonLink>
          <ButtonLink href={`/pesanan/${order.orderNumber}`} variant="secondary">
            Detail pesanan
          </ButtonLink>
          <ButtonLink href="/cari">Lanjut belanja</ButtonLink>
        </div>
      </div>
    </div>
  );
}
