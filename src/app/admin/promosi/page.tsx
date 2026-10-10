import type { Metadata } from "next";
import { hasPermission, requireStaffPage } from "@/server/context";
import { adminListPromotions, promotionUsage } from "@/server/services/promotion.service";
import { formatDate, formatDateTime, formatIDR } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CheckboxRow, Field, SelectInput, TextInput } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/state";
import { Table, Td, Tr } from "@/components/ui/table";
import { setPromotionActiveAction, upsertPromotionAction } from "@/app/actions/admin";

export const metadata: Metadata = {
  title: "Admin - promosi",
  robots: { index: false, follow: false },
};

const STATE_TONE: Record<string, Tone> = {
  active: "success",
  scheduled: "info",
  expired: "neutral",
  paused: "warning",
};

export default async function PromotionsPage({
  searchParams,
}: {
  searchParams: Promise<{ pesan?: string; err?: string }>;
}) {
  const query = await searchParams;
  const ctx = await requireStaffPage("/admin/promosi");
  const canManage = hasPermission(ctx, "promotion.manage");
  const rows = await adminListPromotions(ctx);
  const usage = rows[0] ? await promotionUsage(rows[0].id).catch(() => []) : [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[24px] leading-[32px]">Promosi & kupon</h1>
        <p className="mt-1 text-[13px] text-secondary">
          Kupon divalidasi saat diterapkan (periode, minimum belanja, cap, limit pemakaian). Nilai
          diskon tidak pernah diambil dari klien.
        </p>
      </div>
      {query.pesan ? <Alert tone="success">{query.pesan}</Alert> : null}
      {query.err ? <Alert tone="danger">{query.err}</Alert> : null}

      <Card>
        <CardHeader title="Daftar kupon" />
        {rows.length === 0 ? (
          <EmptyState
            title="Belum ada kupon"
            description="Buat kupon pertama di panel kanan, atau jalankan seed untuk contoh."
            icon="%"
          />
        ) : (
          <Table head={["Kode", "Jenis", "Nilai", "Periode", "Pemakaian", "Status", "Aksi"]}>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td label="Kode">
                  <span className="tnum font-bold">{row.code}</span>
                  <span className="block text-[12px] text-secondary">{row.label}</span>
                </Td>
                <Td label="Jenis">{row.kind}</Td>
                <Td label="Nilai" className="tnum">
                  {row.kind === "percent" ? `${row.value / 100}%` : formatIDR(row.value)}
                  <span className="block text-[12px] text-secondary">
                    min. {formatIDR(row.minSpendAmount)}
                  </span>
                </Td>
                <Td label="Periode" className="text-[13px]">
                  {row.startsAt ? formatDate(row.startsAt) : "-"} s/d{" "}
                  {row.endsAt ? formatDate(row.endsAt) : "-"}
                </Td>
                <Td label="Pemakaian" className="tnum">
                  {row.usedCount}
                  {row.usageLimit ? ` / ${row.usageLimit}` : ""}
                </Td>
                <Td label="Status">
                  <Badge tone={STATE_TONE[row.state] ?? "neutral"}>{row.state}</Badge>
                </Td>
                <Td label="Aksi">
                  {canManage ? (
                    <form action={setPromotionActiveAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="isActive" value={row.isActive ? "off" : "on"} />
                      <Button size="sm" type="submit" variant="secondary">
                        {row.isActive ? "Jeda" : "Aktifkan"}
                      </Button>
                    </form>
                  ) : (
                    <span className="hint">hanya lihat</span>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        {canManage ? (
          <Card>
            <CardHeader
              title="Buat / ubah kupon"
              subtitle="Percent memakai basis points (1000 = 10%). Nilai fixed dalam Rupiah."
            />
            <form action={upsertPromotionAction} className="grid gap-3 sm:grid-cols-2">
              <Field label="Kode" htmlFor="code" required hint="Huruf kapital, tanpa spasi.">
                <TextInput id="code" name="code" required maxLength={32} placeholder="HEMAT50K" />
              </Field>
              <Field label="Label" htmlFor="label" required>
                <TextInput id="label" name="label" required placeholder="Hemat 50 ribu" />
              </Field>
              <Field label="Jenis" htmlFor="kind" required>
                <SelectInput id="kind" name="kind" defaultValue="percent">
                  <option value="percent">percent (basis points)</option>
                  <option value="fixed">fixed (Rupiah)</option>
                  <option value="free_shipping">free_shipping</option>
                </SelectInput>
              </Field>
              <Field label="Nilai" htmlFor="value" required>
                <TextInput id="value" name="value" type="number" min={0} defaultValue={500} />
              </Field>
              <Field label="Minimum belanja (Rp)" htmlFor="minSpendAmount">
                <TextInput
                  id="minSpendAmount"
                  name="minSpendAmount"
                  type="number"
                  min={0}
                  defaultValue={0}
                />
              </Field>
              <Field label="Cap diskon (Rp)" htmlFor="discountCapAmount" hint="Kosong = tanpa cap.">
                <TextInput id="discountCapAmount" name="discountCapAmount" type="number" min={0} />
              </Field>
              <Field label="Mulai" htmlFor="startsAt" required>
                <TextInput
                  id="startsAt"
                  name="startsAt"
                  type="date"
                  defaultValue={today}
                  required
                />
              </Field>
              <Field label="Berakhir" htmlFor="endsAt" required>
                <TextInput
                  id="endsAt"
                  name="endsAt"
                  type="date"
                  defaultValue={`${Number(today.slice(0, 4)) + 1}${today.slice(4)}`}
                  required
                />
              </Field>
              <Field label="Limit total pemakaian" htmlFor="usageLimit">
                <TextInput id="usageLimit" name="usageLimit" type="number" min={0} />
              </Field>
              <Field label="Limit per pelanggan" htmlFor="perCustomerLimit">
                <TextInput id="perCustomerLimit" name="perCustomerLimit" type="number" min={0} />
              </Field>
              <div className="flex flex-wrap gap-4 sm:col-span-2">
                <CheckboxRow id="stackable" name="stackable" label="Boleh digabung promosi lain" />
                <CheckboxRow id="isActive" name="isActive" label="Langsung aktif" defaultChecked />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm">
                  Simpan kupon
                </Button>
              </div>
            </form>
          </Card>
        ) : (
          <Alert tone="info" title="Hanya baca">
            Akun Anda tidak punya promotion.manage; permintaan perubahan perlu diajukan ke
            merchandiser/manager.
          </Alert>
        )}

        <Card>
          <CardHeader
            title={`Pemakaian kupon ${rows[0]?.code ?? "-"}`}
            subtitle="Redemptions terakhir untuk kupon teratas."
          />
          {usage.length === 0 ? (
            <p className="text-[14px] text-secondary">Belum ada pemakaian tercatat.</p>
          ) : (
            <Table head={["Order", "Nominal", "Waktu"]}>
              {usage.slice(0, 8).map((row) => (
                <Tr key={`${row.orderNumber}-${row.createdAt?.getTime() ?? 0}`}>
                  <Td label="Order">{row.orderNumber ?? "-"}</Td>
                  <Td label="Nominal" className="tnum">
                    {formatIDR(row.amount)}
                  </Td>
                  <Td label="Waktu" className="text-[13px]">
                    {row.createdAt ? formatDateTime(row.createdAt) : "-"}
                  </Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
