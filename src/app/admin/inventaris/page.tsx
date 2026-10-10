import type { Metadata } from "next";
import Link from "next/link";
import { ADJUSTMENT_REASONS } from "@/domain/inventory";
import { hasPermission, requireStaffPage } from "@/server/context";
import {
  listInventoryBalances,
  listMovements,
  listPendingStockAdjustments,
  stockApprovalThreshold,
} from "@/server/services/inventory.service";
import { env } from "@/platform/env";
import { formatDateTime } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SelectInput, TextInput } from "@/components/ui/field";
import { Table, Td, Tr } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { adjustStockAction, decideStockAdjustmentAction } from "@/app/actions/admin";

export const metadata: Metadata = {
  title: "Admin - inventaris",
  robots: { index: false, follow: false },
};

const REASON_LABELS: Record<string, string> = {
  cycle_count_variance: "Selisih stock opname",
  damaged_found: "Barang rusak ditemukan",
  damaged_repaired: "Barang rusak diperbaiki",
  theft_or_loss: "Kehilangan / dugaan curian",
  wrong_entry_fix: "Koreksi salah input",
  supplier_shortage: "Barang kurang dari pemasok",
  customer_return_damaged: "Retur pelanggan (rusak)",
  customer_return_resellable: "Retur pelanggan (layak jual)",
  sample_or_internal_use: "Contoh / kebutuhan internal",
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; low?: string; page?: string; pesan?: string; err?: string }>;
}) {
  const query = await searchParams;
  const ctx = await requireStaffPage("/admin/inventaris");
  const page = Number(query.page ?? 1) || 1;
  const [balances, movements, pending, threshold] = await Promise.all([
    listInventoryBalances({ q: query.q, lowOnly: query.low === "1", page, perPage: 20 }),
    listMovements({ sku: query.q, limit: 12 }),
    listPendingStockAdjustments(10),
    stockApprovalThreshold(),
  ]);
  const canAdjust = hasPermission(ctx, "inventory.adjust");
  const canApprove = hasPermission(ctx, "inventory.approve");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] leading-[32px]">Inventaris</h1>
          <p className="mt-1 text-[13px] text-secondary">
            Stok dijual = on hand − reserved − safety stock. Penyesuaian dengan |delta| ≥{" "}
            {threshold} unit wajib disetujui orang lain (maker-checker). Gudang default:{" "}
            {env.defaultLocationCode}.
          </p>
        </div>
        <Link
          href="/admin/audit"
          className="min-h-[36px] inline-flex items-center rounded-control border border-border px-3 text-[13px] font-semibold hover:bg-canvas"
        >
          Audit log
        </Link>
      </div>

      {query.pesan ? <Alert tone="success">{query.pesan}</Alert> : null}
      {query.err ? <Alert tone="danger">{query.err}</Alert> : null}

      {pending.length > 0 ? (
        <Card>
          <CardHeader
            title={`Penyesuaian menunggu keputusan (${pending.length})`}
            subtitle={
              canApprove
                ? "Penyetuju tidak boleh orang yang sama dengan pengaju."
                : "Akun Anda tidak punya izin inventory.approve."
            }
          />
          <Table head={["SKU", "Produk", "Gudang", "Delta", "Alasan", "Pengaju", "Aksi"]}>
            {pending.map((row) => (
              <Tr key={row.id}>
                <Td label="SKU" className="tnum">
                  {row.sku}
                </Td>
                <Td label="Produk">
                  {row.productName}
                  <span className="block text-[12px] text-secondary">{row.variantLabel}</span>
                </Td>
                <Td label="Gudang">{row.locationCode}</Td>
                <Td
                  label="Delta"
                  className={`tnum font-semibold ${row.delta < 0 ? "text-danger" : "text-success"}`}
                >
                  {row.delta > 0 ? `+${row.delta}` : row.delta}
                </Td>
                <Td label="Alasan">
                  {REASON_LABELS[row.reasonCode] ?? row.reasonCode}
                  {row.note ? (
                    <span className="block text-[12px] text-secondary">{row.note}</span>
                  ) : null}
                </Td>
                <Td label="Pengaju">{row.requester ?? "-"}</Td>
                <Td label="Aksi">
                  {canApprove ? (
                    <form
                      action={decideStockAdjustmentAction}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <input type="hidden" name="requestId" value={row.id} />
                      <input
                        size={24}
                        name="note"
                        placeholder="Catatan keputusan"
                        className="control h-9 min-h-9 w-40"
                      />
                      <Button
                        size="sm"
                        type="submit"
                        variant="success"
                        name="decision"
                        value="approved"
                      >
                        Setujui
                      </Button>
                      <button
                        type="submit"
                        name="decision"
                        value="rejected"
                        className="min-h-[36px] rounded-control border border-border px-3 text-[13px] font-semibold text-danger hover:bg-danger-soft"
                      >
                        Tolak
                      </button>
                    </form>
                  ) : (
                    <span className="hint">menunggu penyetuju lain</span>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Kartu stok"
          subtitle={`${balances.total} varian · gunakan filter untuk mencari SKU atau melihat yang menipis.`}
        />
        <form method="get" action="/admin/inventaris" className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[240px] flex-1 flex-col gap-1">
            <span className="label">SKU / nama produk</span>
            <input name="q" defaultValue={query.q ?? ""} className="control" />
          </label>
          <label className="flex items-center gap-2 text-[14px] font-semibold">
            <input
              type="checkbox"
              name="low"
              value="1"
              defaultChecked={query.low === "1"}
              className="size-5 rounded-tile accent-brand"
            />
            Hanya stok menipis / habis
          </label>
          <button
            type="submit"
            className="min-h-[44px] rounded-control bg-brand px-4 text-[15px] font-semibold text-white hover:bg-brand-hover"
          >
            Terapkan
          </button>
        </form>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left text-[14px]">
            <thead className="bg-canvas text-[12px] uppercase tracking-wide text-secondary">
              <tr>
                <th className="px-4 py-2 font-semibold">SKU / varian</th>
                <th className="px-4 py-2 font-semibold">On hand</th>
                <th className="px-4 py-2 font-semibold">Reserved</th>
                <th className="px-4 py-2 font-semibold">Rusak</th>
                <th className="px-4 py-2 font-semibold">Safety</th>
                <th className="px-4 py-2 font-semibold">Tersedia</th>
                <th className="px-4 py-2 font-semibold">Penyesuaian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {balances.rows.map((row) => (
                <tr key={`${row.sku}-${row.locationCode}`} className="align-top hover:bg-canvas/60">
                  <td className="px-4 py-3">
                    <span className="tnum block font-semibold text-ink">{row.sku}</span>
                    <span className="block text-[12px] text-secondary">
                      {row.productName} · {row.variantLabel} · {row.locationCode}
                    </span>
                    <Badge
                      tone={
                        row.status === "in_stock"
                          ? "success"
                          : row.status === "low_stock"
                            ? "warning"
                            : "danger"
                      }
                      className="mt-1"
                    >
                      {row.status === "in_stock"
                        ? "aman"
                        : row.status === "low_stock"
                          ? "menipis"
                          : "habis"}
                    </Badge>
                  </td>
                  <td className="tnum px-4 py-3">{row.onHand}</td>
                  <td className="tnum px-4 py-3">{row.reserved}</td>
                  <td className="tnum px-4 py-3">{row.damaged}</td>
                  <td className="tnum px-4 py-3">{row.safetyStock}</td>
                  <td className="tnum px-4 py-3 font-semibold">{row.available}</td>
                  <td className="px-4 py-3">
                    {canAdjust ? (
                      <form action={adjustStockAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="sku" value={row.sku} />
                        <input type="hidden" name="locationCode" value={row.locationCode} />
                        <input type="hidden" name="backTo" value="/admin/inventaris" />
                        <label className="flex flex-col gap-1">
                          <span className="hint">Delta (±)</span>
                          <TextInput
                            name="delta"
                            type="number"
                            step={1}
                            className="h-9 min-h-9 w-20"
                            defaultValue={0}
                            required
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="hint">Alasan</span>
                          <SelectInput
                            name="reason"
                            className="h-9 min-h-9 w-44"
                            defaultValue="cycle_count_variance"
                          >
                            {ADJUSTMENT_REASONS.map((reason) => (
                              <option key={reason} value={reason}>
                                {REASON_LABELS[reason] ?? reason}
                              </option>
                            ))}
                          </SelectInput>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="hint">Catatan</span>
                          <TextInput name="note" className="h-9 min-h-9 w-40" />
                        </label>
                        <Button size="sm" type="submit" variant="secondary">
                          Simpan
                        </Button>
                      </form>
                    ) : (
                      <span className="hint">tanpa izin inventory.adjust</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={balances.page}
          perPage={balances.perPage}
          total={balances.total}
          base="/admin/inventaris"
          searchParams={{ q: query.q, low: query.low }}
        />
      </Card>

      <Card>
        <CardHeader
          title="Pergerakan terakhir"
          subtitle="Ledger append-only; tidak ada baris yang diubah, hanya dikoreksi dengan baris lawan."
        />
        <Table head={["Waktu", "SKU", "Jenis", "Qty", "Alasan", "Catatan", "Oleh"]}>
          {movements.map((movement) => (
            <Tr key={movement.id}>
              <Td label="Waktu" className="text-[13px]">
                {movement.createdAt ? formatDateTime(movement.createdAt) : "-"}
              </Td>
              <Td label="SKU" className="tnum">
                {movement.sku}
              </Td>
              <Td label="Jenis">{movement.kind}</Td>
              <Td
                label="Qty"
                className={`tnum font-semibold ${movement.quantity < 0 ? "text-danger" : "text-success"}`}
              >
                {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}
              </Td>
              <Td label="Alasan">
                {REASON_LABELS[movement.reasonCode ?? ""] ?? movement.reasonCode ?? "-"}
              </Td>
              <Td label="Catatan">{movement.note ?? "-"}</Td>
              <Td label="Oleh">{movement.actor ?? "sistem"}</Td>
            </Tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
