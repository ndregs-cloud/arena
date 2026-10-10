import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCustomerPage } from "@/server/context";
import { getReturnForCustomer } from "@/server/services/return.service";
import { RETURN_STATUS_LABELS } from "@/domain/returns";
import { formatDate, formatDateTime, formatIDR } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusChip } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, Td, Tr } from "@/components/ui/table";

export const metadata: Metadata = {
  title: "Status retur",
  robots: { index: false, follow: false },
};

const RESOLUTION_LABELS: Record<string, string> = {
  refund: "Refund ke metode pembayaran",
  exchange: "Tukar barang",
  store_credit: "Kredit toko",
  none: "Tanpa pengembalian dana",
};

export default async function ReturnDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ pesan?: string }>;
}) {
  const [{ reference }, query] = await Promise.all([params, searchParams]);
  const ctx = await requireCustomerPage("/retur/[reference]");
  if (!ctx.user) redirect(`/masuk?setelah=${encodeURIComponent(`/retur/${reference}`)}`);
  const data = await getReturnForCustomer(ctx, reference).catch(() => null);
  if (!data) notFound();

  const nextStep =
    data.status === "requested"
      ? "Menunggu keputusan tim. Anda akan menerima notifikasi setelah ditinjau."
      : data.status === "awaiting_return"
        ? `Kirim barang ke alamat gudang yang tercantum di notifikasi, sertakan nomor ${data.reference}. Tenggat: ${data.deadlineAt ? formatDate(data.deadlineAt) : "-"}.`
        : data.status === "item_received" || data.status === "inspected"
          ? "Barang diterima dan sedang diperiksa. Dana diproses setelah pemeriksaan selesai."
          : data.status === "resolved"
            ? data.refundStatus && data.refundStatus !== "none"
              ? `Refund ${data.refundStatus}.`
              : "Retur selesai."
            : data.status === "rejected"
              ? "Retur ditolak. Lihat catatan keputusan di riwayat."
              : "Retur ditutup.";

  return (
    <div className="page section">
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-secondary">
        <Link href="/akun/retur" className="hover:underline">
          Retur saya
        </Link>
        <span aria-hidden="true"> › </span>
        <span className="text-ink-soft">{data.reference}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] leading-[32px]">Retur {data.reference}</h1>
          <p className="mt-1 text-[14px] text-secondary">
            Pesanan{" "}
            <Link className="link" href={`/pesanan/${data.orderNumber}`}>
              {data.orderNumber}
            </Link>{" "}
            · diajukan {data.createdAt ? formatDateTime(data.createdAt) : "-"}
          </p>
        </div>
        <StatusChip
          kind="return"
          status={data.status}
          label={RETURN_STATUS_LABELS[data.status] ?? data.status}
        />
      </div>

      {query.pesan ? (
        <Alert tone="success" className="mt-4">
          {query.pesan}
        </Alert>
      ) : null}
      <Alert tone="info" className="mt-4" title="Langkah berikutnya">
        {nextStep}
      </Alert>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Item yang diretur" />
            <Table
              head={["Produk", "Diminta", "Diterima", "Dikembalikan ke stok", "Rusak", "Nilai"]}
            >
              {data.items.map((item) => (
                <Tr key={item.orderItemId}>
                  <Td label="Produk">
                    <span className="block font-semibold text-ink">{item.productName}</span>
                    <span className="block text-[13px] text-secondary">{item.variantLabel}</span>
                  </Td>
                  <Td label="Diminta">{item.quantityRequested}</Td>
                  <Td label="Diterima">{item.quantityReceived}</Td>
                  <Td label="Restock">{item.quantityRestocked}</Td>
                  <Td label="Rusak">{item.quantityDamaged}</Td>
                  <Td label="Nilai" className="tnum">
                    {formatIDR(item.amount)}
                  </Td>
                </Tr>
              ))}
            </Table>
          </Card>

          <Card>
            <CardHeader title="Riwayat kasus" />
            <ol className="flex flex-col gap-3">
              {data.timeline
                .filter((entry) => entry.visibility !== "internal")
                .map((entry) => (
                  <li key={entry.id} className="border-l-2 border-border pl-3">
                    <p className="text-[14px] font-semibold text-ink">{entry.note ?? entry.type}</p>
                    <p className="text-[12px] text-secondary">
                      {entry.createdAt ? formatDateTime(entry.createdAt) : ""}
                    </p>
                  </li>
                ))}
            </ol>
          </Card>
        </div>

        <Card>
          <CardHeader title="Ringkasan" />
          <dl className="flex flex-col gap-2 text-[14px]">
            <div className="flex justify-between gap-3">
              <dt className="text-secondary">Alasan</dt>
              <dd className="text-right font-semibold">{data.reasonLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-secondary">Penyelesaian</dt>
              <dd className="text-right font-semibold">
                {RESOLUTION_LABELS[data.resolution] ?? data.resolution}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-secondary">Diajukan</dt>
              <dd className="tnum text-right font-semibold">{formatIDR(data.requestedAmount)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-secondary">Disetujui</dt>
              <dd className="tnum text-right font-semibold">
                {data.approvedAmount == null ? "-" : formatIDR(data.approvedAmount)}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border pt-2">
              <dt className="text-secondary">Status refund</dt>
              <dd className="text-right">
                {data.refundStatus && data.refundStatus !== "none" ? (
                  <StatusChip
                    kind="payment"
                    status={data.refundStatus}
                    label={data.refundStatus.replace(/_/g, " ")}
                  />
                ) : (
                  <Badge tone="neutral">belum ada refund</Badge>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-secondary">Nominal refund</dt>
              <dd className="tnum text-right font-semibold">
                {data.refundAmount ? formatIDR(data.refundAmount) : "-"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-secondary">Versi kebijakan</dt>
              <dd className="tnum text-right">{data.policyVersion}</dd>
            </div>
          </dl>
          {data.decisionNote ? (
            <div className="mt-3 rounded-card border border-border bg-canvas p-3 text-[13px] leading-[19px] text-ink-soft">
              <p className="label mb-1">Catatan keputusan</p>
              {data.decisionNote}
            </div>
          ) : null}
          <p className="hint mt-3">
            Nilai retur mengikuti porsi diskon pada baris terkait, jadi total yang dikembalikan
            tidak pernah melebihi yang Anda bayar.
          </p>
        </Card>
      </div>
    </div>
  );
}
