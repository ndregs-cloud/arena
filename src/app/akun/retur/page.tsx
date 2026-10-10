import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomerPage } from "@/server/context";
import { listCustomerReturns } from "@/server/services/return.service";
import { RETURN_STATUS_LABELS } from "@/domain/returns";
import { formatDate, formatIDR } from "@/lib/format";
import { StatusChip } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/state";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Retur & refund",
  robots: { index: false, follow: false },
};

export default async function CustomerReturnsPage() {
  const ctx = await requireCustomerPage("/akun/retur");
  const rows = await listCustomerReturns(ctx);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Tidak ada pengajuan retur"
        description="Retur dapat diajukan maksimal 14 hari setelah pesanan berstatus terkirim, langsung dari halaman detail pesanan."
        action={<ButtonLink href="/akun/pesanan">Buka daftar pesanan</ButtonLink>}
        icon="↩"
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((item) => (
        <li key={item.id}>
          <article className="card card-pad flex flex-wrap items-center gap-4">
            <div className="min-w-[200px] flex-1">
              <p className="tnum text-[15px] font-bold text-ink">{item.reference}</p>
              <p className="text-[13px] text-secondary">
                Pesanan{" "}
                <Link className="link" href={`/pesanan/${item.orderNumber}`}>
                  {item.orderNumber}
                </Link>{" "}
                · diajukan {item.createdAt ? formatDate(item.createdAt) : "-"}
              </p>
              <p className="mt-1 text-[13px] text-ink-soft">
                {item.items.length} item · {item.reasonLabel} · penyelesaian {item.resolution}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip
                kind="return"
                status={item.status}
                label={RETURN_STATUS_LABELS[item.status] ?? item.status}
              />
              {item.refundStatus && item.refundStatus !== "none" ? (
                <StatusChip
                  kind="payment"
                  status={item.refundStatus}
                  label={`Refund ${item.refundStatus}`}
                />
              ) : null}
            </div>
            <p className="tnum min-w-[120px] text-right text-[15px] font-bold">
              {formatIDR(item.approvedAmount ?? item.requestedAmount)}
            </p>
            <ButtonLink size="sm" variant="secondary" href={`/retur/${item.reference}`}>
              Pantau retur
            </ButtonLink>
          </article>
        </li>
      ))}
    </ul>
  );
}
