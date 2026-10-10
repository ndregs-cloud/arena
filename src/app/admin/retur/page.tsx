import type { Metadata } from "next";
import Link from "next/link";
import { RETURN_STATUSES, RETURN_STATUS_LABELS } from "@/domain/returns";
import { hasPermission, requireStaffPage } from "@/server/context";
import { env } from "@/platform/env";
import { adminGetReturn, adminListReturns } from "@/server/services/return.service";
import { formatDate, formatDateTime, formatIDR } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CheckboxRow, Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/state";
import { Table, Td, Tr } from "@/components/ui/table";
import {
  decideReturnAction,
  inspectReturnAction,
  receiveReturnAction,
  resolveReturnAction,
} from "@/app/actions/admin";

export const metadata: Metadata = {
  title: "Admin - retur",
  robots: { index: false, follow: false },
};

export default async function AdminReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; id?: string; pesan?: string; err?: string }>;
}) {
  const query = await searchParams;
  const ctx = await requireStaffPage("/admin/retur");
  const rows = await adminListReturns(ctx, { status: query.status });
  const detail = query.id ? await adminGetReturn(ctx, query.id).catch(() => null) : null;
  const canApprove = hasPermission(ctx, "return.approve");
  const canManage = hasPermission(ctx, "return.manage");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] leading-[32px]">Retur & refund</h1>
          <p className="mt-1 text-[13px] text-secondary">
            {rows.length} kasus pada filter ini. Persetujuan retur dan pencairan dana adalah dua
            langkah berbeda.
          </p>
        </div>
        <form method="get" action="/admin/retur" className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="label">Status</span>
            <select
              name="status"
              defaultValue={query.status ?? ""}
              className="control min-w-[180px]"
            >
              <option value="">Semua</option>
              {RETURN_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {RETURN_STATUS_LABELS[status] ?? status}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="min-h-[44px] rounded-control bg-brand px-4 text-[15px] font-semibold text-white hover:bg-brand-hover"
          >
            Terapkan
          </button>
        </form>
      </div>

      {query.pesan ? <Alert tone="success">{query.pesan}</Alert> : null}
      {query.err ? <Alert tone="danger">{query.err}</Alert> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Card>
          <CardHeader title="Daftar kasus" />
          {rows.length === 0 ? (
            <EmptyState
              title="Tidak ada retur"
              description="Pengajuan dari pelanggan akan muncul di sini."
              icon="↩"
            />
          ) : (
            <Table head={["Referensi", "Pesanan", "Pelanggan", "Nilai", "Status", "Dibuat"]}>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td label="Referensi">
                    <Link className="link font-semibold" href={`/admin/retur?id=${row.id}`}>
                      {row.reference}
                    </Link>
                    <span className="block text-[12px] text-secondary">{row.reasonLabel}</span>
                  </Td>
                  <Td label="Pesanan">
                    <Link className="link" href={`/admin/pesanan/${row.orderNumber}`}>
                      {row.orderNumber}
                    </Link>
                  </Td>
                  <Td label="Pelanggan">
                    {row.customerName ?? "-"}
                    <span className="block text-[12px] text-secondary">{row.customerEmail}</span>
                  </Td>
                  <Td label="Nilai" className="tnum">
                    {formatIDR(row.requestedAmount)}
                    {row.approvedAmount != null ? (
                      <span className="block text-[12px] text-success">
                        disetujui {formatIDR(row.approvedAmount)}
                      </span>
                    ) : null}
                  </Td>
                  <Td label="Status">
                    <StatusChip
                      kind="return"
                      status={row.status}
                      label={RETURN_STATUS_LABELS[row.status] ?? row.status}
                    />
                    {row.refundStatus && row.refundStatus !== "none" ? (
                      <Badge tone="info" className="ml-1">
                        refund {row.refundStatus}
                      </Badge>
                    ) : null}
                  </Td>
                  <Td label="Dibuat" className="text-[13px]">
                    {row.createdAt ? formatDate(row.createdAt) : "-"}
                  </Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          {!detail ? (
            <Card>
              <CardHeader title="Detail kasus" />
              <p className="text-[14px] text-secondary">
                Pilih satu referensi di daftar untuk melihat item, riwayat, dan aksi yang tersedia.
              </p>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader
                  title={detail.reference}
                  subtitle={`${detail.reasonLabel} · penyelesaian ${detail.resolution} · tenggat kirim ${detail.deadlineAt ? formatDate(detail.deadlineAt) : "-"}`}
                  action={
                    <StatusChip
                      kind="return"
                      status={detail.status}
                      label={RETURN_STATUS_LABELS[detail.status] ?? detail.status}
                    />
                  }
                />
                <Table head={["Item", "Diminta", "Diterima", "Restock", "Rusak", "Nilai"]}>
                  {detail.items.map((item) => (
                    <Tr key={item.orderItemId}>
                      <Td label="Item">
                        {item.productName}
                        <span className="block text-[12px] text-secondary">
                          {item.variantLabel}
                        </span>
                      </Td>
                      <Td label="Diminta" className="tnum">
                        {item.quantityRequested}
                      </Td>
                      <Td label="Diterima" className="tnum">
                        {item.quantityReceived}
                      </Td>
                      <Td label="Restock" className="tnum">
                        {item.quantityRestocked}
                      </Td>
                      <Td label="Rusak" className="tnum">
                        {item.quantityDamaged}
                      </Td>
                      <Td label="Nilai" className="tnum">
                        {formatIDR(item.amount)}
                      </Td>
                    </Tr>
                  ))}
                </Table>
                {detail.description ? (
                  <div className="mt-3 rounded-card border border-border bg-canvas p-3 text-[13px] leading-[19px] text-ink-soft">
                    <p className="label mb-1">Keterangan pelanggan</p>
                    {detail.description}
                  </div>
                ) : null}
              </Card>

              {detail.status === "requested" && canApprove ? (
                <Card>
                  <CardHeader
                    title="Keputusan retur"
                    subtitle="Menyetujui membuka tenggat kirim balik 10 hari; menolak mengirim alasan ke pelanggan."
                  />
                  <form action={decideReturnAction} className="flex flex-col gap-3">
                    <input type="hidden" name="id" value={detail.id} />
                    <input type="hidden" name="backTo" value={`/admin/retur?id=${detail.id}`} />
                    <Field
                      label="Catatan keputusan"
                      htmlFor="decide-note"
                      required
                      hint="Teks ini terlihat pelanggan."
                    >
                      <TextArea
                        id="decide-note"
                        name="note"
                        rows={2}
                        required
                        placeholder="Mis. sesuai laporan; silakan kirim ke gudang dengan menyertakan nomor retur."
                      />
                    </Field>
                    <Field
                      label="Nilai yang disetujui (Rp)"
                      htmlFor="approved-amount"
                      hint={`Kosong = gunakan nilai diajukan ${formatIDR(detail.requestedAmount)}.`}
                    >
                      <TextInput
                        id="approved-amount"
                        name="approvedAmount"
                        type="number"
                        min={0}
                        defaultValue={detail.requestedAmount}
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        type="submit"
                        variant="success"
                        name="decision"
                        value="approved"
                      >
                        Setujui retur
                      </Button>
                      <button
                        type="submit"
                        name="decision"
                        value="rejected"
                        className="min-h-[36px] rounded-control border border-border px-3 text-[13px] font-semibold text-danger hover:bg-danger-soft"
                      >
                        Tolak
                      </button>
                    </div>
                  </form>
                </Card>
              ) : null}

              {detail.status === "requested" && !canApprove && canManage ? (
                <Alert tone="info" title="Menunggu penyetuju">
                  Anda dapat memproses retur (terima/inspeksi), tapi persetujuan nilai membutuhkan
                  izin return.approve.
                </Alert>
              ) : null}

              {detail.status === "awaiting_return" && canManage ? (
                <Card>
                  <CardHeader
                    title="Terima barang"
                    subtitle="Catat jumlah yang benar-benar tiba; barang rusak tidak masuk stok jual."
                  />
                  <form action={receiveReturnAction} className="flex flex-col gap-3">
                    <input type="hidden" name="returnId" value={detail.id} />
                    <input type="hidden" name="backTo" value={`/admin/retur?id=${detail.id}`} />
                    {detail.items.map((item) => (
                      <Field
                        key={item.orderItemId}
                        label={`${item.productName} (${item.variantLabel})`}
                        htmlFor={`recv-${item.orderItemId}`}
                        hint={`Diminta ${item.quantityRequested}.`}
                      >
                        <TextInput
                          id={`recv-${item.orderItemId}`}
                          name={`recv:${item.orderItemId}`}
                          type="number"
                          min={0}
                          max={item.quantityRequested}
                          defaultValue={item.quantityRequested}
                        />
                      </Field>
                    ))}
                    <Button size="sm" type="submit">
                      Simpan penerimaan
                    </Button>
                  </form>
                </Card>
              ) : null}

              {["item_received", "inspected"].includes(detail.status) && canManage ? (
                <Card>
                  <CardHeader
                    title="Inspeksi &amp; penyelesaian"
                    subtitle="Barang layak jual otomatis diusulkan untuk restock; refund dibuat sebagai ledger terpisah."
                  />
                  <form action={inspectReturnAction} className="flex flex-col gap-3">
                    <input type="hidden" name="returnId" value={detail.id} />
                    <input type="hidden" name="backTo" value={`/admin/retur?id=${detail.id}`} />
                    <CheckboxRow
                      id="insp-passed"
                      name="passed"
                      label="Lulus inspeksi (layak jual)"
                      defaultChecked
                    />
                    <Field label="Hasil pemeriksaan" htmlFor="insp-note" required>
                      <TextArea
                        id="insp-note"
                        name="note"
                        rows={2}
                        required
                        placeholder="Mis. segel rusak, fungsi normal, unit masuk stok."
                      />
                    </Field>
                    <Button size="sm" type="submit" variant="secondary">
                      Simpan hasil inspeksi
                    </Button>
                  </form>
                  <form
                    action={resolveReturnAction}
                    className="mt-4 flex flex-col gap-3 border-t border-border pt-4"
                  >
                    <input type="hidden" name="returnId" value={detail.id} />
                    <input type="hidden" name="backTo" value={`/admin/retur?id=${detail.id}`} />
                    <Field label="Penyelesaian" htmlFor="resolve-kind" required>
                      <SelectInput
                        id="resolve-kind"
                        name="resolution"
                        defaultValue={detail.resolution}
                      >
                        <option value="refund">Refund ke metode pembayaran</option>
                        <option value="exchange">Tukar barang</option>
                        <option value="store_credit">Kredit toko</option>
                        <option value="none">Tanpa pengembalian dana</option>
                      </SelectInput>
                    </Field>
                    <Field label="Catatan penutupan" htmlFor="resolve-note" required>
                      <TextArea
                        id="resolve-note"
                        name="note"
                        rows={2}
                        required
                        placeholder="Mis. refund sesuai nilai disetujui."
                      />
                    </Field>
                    <Button size="sm" type="submit">
                      Tutup retur
                    </Button>
                    <p className="hint">
                      Refund di atas ambang {formatIDR(env.refundAutoApproveLimit)} tetap butuh
                      persetujuan finance di halaman pesanan (maker-checker).
                    </p>
                  </form>
                </Card>
              ) : null}

              <Card>
                <CardHeader title="Riwayat kasus" />
                <ol className="flex flex-col gap-3">
                  {detail.timeline.map((entry) => (
                    <li key={entry.id} className="border-l-2 border-border pl-3">
                      <p className="text-[14px] font-semibold text-ink">
                        {entry.note ?? entry.type}
                      </p>
                      <p className="text-[12px] text-secondary">
                        {entry.createdAt ? formatDateTime(entry.createdAt) : "-"}
                      </p>
                    </li>
                  ))}
                </ol>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
