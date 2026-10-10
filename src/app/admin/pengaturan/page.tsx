import type { Metadata } from "next";
import { hasPermission, requireStaffPage } from "@/server/context";
import {
  SETTING_SPECS,
  getSiteSettings,
  listPoliciesForAdmin,
} from "@/server/services/admin.service";
import { env } from "@/platform/env";
import { formatDate, formatIDR } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { Table, Td, Tr } from "@/components/ui/table";
import { publishPolicyAction, updateSettingsAction } from "@/app/actions/admin";

export const metadata: Metadata = {
  title: "Admin - pengaturan",
  robots: { index: false, follow: false },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ pesan?: string; err?: string }>;
}) {
  const query = await searchParams;
  const ctx = await requireStaffPage("/admin/pengaturan");
  const canEdit = hasPermission(ctx, "settings.manage");
  const canContent = hasPermission(ctx, "content.manage");
  const [settings, policies] = await Promise.all([
    getSiteSettings(),
    listPoliciesForAdmin(ctx).catch(() => []),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[24px] leading-[32px]">Pengaturan</h1>
        <p className="mt-1 text-[13px] text-secondary">
          Nilai di sini menutupi default environment. Kredensial provider TIDAK pernah disimpan di
          basis data - hanya lewat env deployment.
        </p>
      </div>

      {query.pesan ? <Alert tone="success">{query.pesan}</Alert> : null}
      {query.err ? <Alert tone="danger">{query.err}</Alert> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Parameter bisnis"
            subtitle={
              canEdit
                ? "Perubahan langsung dipakai perhitungan berikutnya."
                : "Hanya baca untuk role ini."
            }
          />
          <form action={updateSettingsAction} className="flex flex-col gap-3">
            <input type="hidden" name="backTo" value="/admin/pengaturan" />
            {settings.map((setting) => (
              <Field
                key={setting.key}
                label={setting.label}
                htmlFor={`setting-${setting.key}`}
                hint={setting.hint}
              >
                {setting.type === "boolean" ? (
                  <select
                    id={`setting-${setting.key}`}
                    name={`setting:${setting.key}`}
                    className="control"
                    defaultValue={String(Boolean(setting.value))}
                  >
                    <option value="true">Aktif</option>
                    <option value="false">Nonaktif</option>
                  </select>
                ) : (
                  <TextInput
                    id={`setting-${setting.key}`}
                    name={`setting:${setting.key}`}
                    type={
                      setting.type === "integer" || setting.type === "money" ? "number" : "text"
                    }
                    min={setting.min}
                    max={setting.max}
                    defaultValue={String(setting.value ?? "")}
                    disabled={!canEdit}
                  />
                )}
                {setting.isOverridden ? (
                  <span className="hint mt-1 block">
                    menimpa default ({String(setting.defaultValue)})
                  </span>
                ) : null}
              </Field>
            ))}
            <Button type="submit" size="sm" disabled={!canEdit}>
              Simpan pengaturan
            </Button>
          </form>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Nilai lingkungan (read-only)"
              subtitle="Dibaca dari env; ubah lewat deployment, bukan UI."
            />
            <Table head={["Parameter", "Nilai"]}>
              {[
                {
                  label: "Driver data",
                  value:
                    env.dataDriver + (env.isEmbeddedDatabase ? " (tertanam - bukan produksi)" : ""),
                },
                {
                  label: "Batas auto-approve refund",
                  value: formatIDR(env.refundAutoApproveLimit),
                },
                { label: "Batas bayar pesanan", value: `${env.paymentTimeoutMinutes} menit` },
                { label: "TTL reservasi stok", value: `${env.reservationTtlMinutes} menit` },
                { label: "Jendela retur", value: `${env.returnWindowDays} hari` },
                { label: "MFA wajib untuk staf", value: env.requireMfaForStaff ? "ya" : "tidak" },
                { label: "Sink notifikasi", value: env.notifySink },
                { label: "Zona waktu operator", value: env.operatorTimezone },
              ].map((row) => (
                <Tr key={row.label}>
                  <Td label="Parameter">{row.label}</Td>
                  <Td label="Nilai" className="tnum font-semibold">
                    {row.value}
                  </Td>
                </Tr>
              ))}
            </Table>
          </Card>

          <Card>
            <CardHeader
              title="Kebijakan"
              subtitle="Menbitkan versi baru; pesanan selalu menyimpan versi yang disetujui pelanggan."
            />
            {policies.length === 0 ? (
              <p className="text-[14px] text-secondary">
                Belum ada dokumen kebijakan (butuh izin content.manage untuk melihatnya).
              </p>
            ) : (
              <Table head={["Dokumen", "Versi", "Berlaku", "Status"]}>
                {policies.map((policy) => (
                  <Tr key={`${policy.key}-${policy.version}`}>
                    <Td label="Dokumen">
                      {policy.title}
                      <span className="block text-[12px] text-secondary">{policy.key}</span>
                    </Td>
                    <Td label="Versi" className="tnum">
                      {policy.version}
                    </Td>
                    <Td label="Berlaku" className="text-[13px]">
                      {policy.effectiveAt ? formatDate(policy.effectiveAt) : "-"}
                    </Td>
                    <Td label="Status">
                      {policy.isCurrent ? (
                        <Badge tone="success">berlaku</Badge>
                      ) : (
                        <Badge tone="neutral">arsip</Badge>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Table>
            )}
            {canContent ? (
              <form
                action={publishPolicyAction}
                className="mt-4 flex flex-col gap-3 border-t border-border pt-4"
              >
                <input type="hidden" name="backTo" value="/admin/pengaturan" />
                <Field
                  label="Kunci dokumen"
                  htmlFor="policy-key"
                  required
                  hint="Mis. syarat, privasi, pengiriman, retur."
                >
                  <TextInput
                    id="policy-key"
                    name="key"
                    required
                    list="policy-keys"
                    defaultValue="pengiriman"
                  />
                </Field>
                <datalist id="policy-keys">
                  {["syarat", "privasi", "pengiriman", "retur"].map((key) => (
                    <option key={key} value={key} />
                  ))}
                </datalist>
                <Field label="Judul" htmlFor="policy-title" required>
                  <TextInput
                    id="policy-title"
                    name="title"
                    required
                    defaultValue="Kebijakan Pengiriman"
                  />
                </Field>
                <Field label="Isi dokumen" htmlFor="policy-body" required>
                  <TextArea
                    id="policy-body"
                    name="body"
                    rows={6}
                    required
                    placeholder="Tulis kebijakan lengkap; versi lama tetap tersimpan sebagai arsip."
                  />
                </Field>
                <Button type="submit" size="sm">
                  Terbitkan versi baru
                </Button>
              </form>
            ) : (
              <p className="hint mt-3">Menerbitkan kebijakan butuh izin content.manage.</p>
            )}
          </Card>
        </div>
      </div>

      <Alert tone="info" title="Yang sengaja tidak ada di halaman ini">
        Kunci API pembayaran/kurir, kredensial SMTP, dan rahasia signing webhook. Nilai itu hanya
        dibaca dari environment deployment ({SETTING_SPECS.length} parameter bisnis tersedia di
        atas).
      </Alert>
    </div>
  );
}
