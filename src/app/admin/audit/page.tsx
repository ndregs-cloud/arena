import type { Metadata } from "next";
import Link from "next/link";
import { hasPermission, requireStaffPage } from "@/server/context";
import { searchAudit } from "@/server/services/admin.service";
import { formatDateTime } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { Table, Td, Tr } from "@/components/ui/table";

export const metadata: Metadata = {
  title: "Admin - audit log",
  robots: { index: false, follow: false },
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ targetType?: string; targetId?: string; cursor?: string; err?: string }>;
}) {
  const query = await searchParams;
  const ctx = await requireStaffPage("/admin/audit");
  if (!hasPermission(ctx, "audit.view")) {
    return (
      <Alert tone="danger" title="Akses ditolak">
        Audit log hanya untuk role dengan izin <code>audit.view</code> (finance, manager, auditor,
        admin).{" "}
        <Link href="/admin" className="link font-semibold">
          Kembali ke ringkasan
        </Link>
        .
      </Alert>
    );
  }
  const result = await searchAudit(ctx, {
    targetType: query.targetType,
    targetId: query.targetId,
    limit: 50,
    cursor: query.cursor ? Number(query.cursor) : undefined,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] leading-[32px]">Audit log</h1>
          <p className="mt-1 text-[13px] text-secondary">
            Siapa mengubah apa, kapan, dan dari permintaan mana. Entri tidak dapat diedit dari UI.
          </p>
        </div>
        <form method="get" action="/admin/audit" className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="label">Jenis objek</span>
            <input
              name="targetType"
              defaultValue={query.targetType ?? ""}
              className="control h-11 w-40"
              placeholder="order, product…"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Id objek</span>
            <input
              name="targetId"
              defaultValue={query.targetId ?? ""}
              className="control h-11 w-56"
            />
          </label>
          <button
            type="submit"
            className="min-h-[44px] rounded-control bg-brand px-4 text-[15px] font-semibold text-white"
          >
            Cari
          </button>
        </form>
      </div>

      {query.err ? <Alert tone="danger">{query.err}</Alert> : null}

      {result.rows.length === 0 ? (
        <EmptyState
          title="Tidak ada entri"
          description="Belum ada aksi tercatat untuk filter ini."
          icon="⌕"
        />
      ) : (
        <Table head={["Waktu", "Aktor", "Aksi", "Objek", "Alasan", "Perubahan"]}>
          {result.rows.map((row) => (
            <Tr key={row.id}>
              <Td label="Waktu" className="whitespace-nowrap text-[13px]">
                {row.createdAt ? formatDateTime(row.createdAt) : "-"}
              </Td>
              <Td label="Aktor">
                {row.actorEmail}
                <span className="block text-[12px] text-secondary">{row.actorKind}</span>
              </Td>
              <Td label="Aksi">
                <Badge tone="neutral">{row.action}</Badge>
              </Td>
              <Td label="Objek" className="text-[13px]">
                {row.targetType}
                <span className="block text-[12px] text-secondary">{row.targetId ?? "-"}</span>
              </Td>
              <Td label="Alasan" className="text-[13px]">
                {row.reason ?? "-"}
              </Td>
              <Td label="Perubahan">
                <details className="max-w-[320px]">
                  <summary className="cursor-pointer text-[13px] font-semibold text-brand">
                    Lihat diff
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-card border border-border bg-canvas p-2 text-[11px] leading-[15px]">
                    {JSON.stringify(
                      { before: row.before, after: row.after, requestId: row.requestId },
                      null,
                      1,
                    )}
                  </pre>
                </details>
              </Td>
            </Tr>
          ))}
        </Table>
      )}

      {result.nextCursor ? (
        <Link
          href={`/admin/audit?cursor=${result.nextCursor}${query.targetType ? `&targetType=${encodeURIComponent(query.targetType)}` : ""}${query.targetId ? `&targetId=${encodeURIComponent(query.targetId)}` : ""}`}
          className="min-h-[44px] inline-flex w-fit items-center rounded-control border border-border bg-surface px-4 text-[14px] font-semibold hover:bg-canvas"
        >
          Muat 50 entri berikutnya
        </Link>
      ) : (
        <p className="hint">Tidak ada entri lanjutan untuk filter ini.</p>
      )}
    </div>
  );
}
