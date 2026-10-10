import type { Metadata } from "next";
import { requireCustomerPage } from "@/server/context";
import { consentOverview, listPrivacyRequests } from "@/server/services/account.service";
import { PRIVACY_KIND_LABELS } from "@/server/services/account.service";
import { formatDateTime } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, TextArea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { createPrivacyRequestAction } from "@/app/actions/account";
import { Table, Td, Tr } from "@/components/ui/table";

export const metadata: Metadata = {
  title: "Privasi data",
  robots: { index: false, follow: false },
};

export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ pesan?: string }>;
}) {
  const { pesan } = await searchParams;
  const ctx = await requireCustomerPage("/akun/privasi");
  const [overview, requests] = await Promise.all([consentOverview(ctx), listPrivacyRequests(ctx)]);

  return (
    <div className="flex flex-col gap-4">
      {pesan ? <Alert tone="success">{pesan}</Alert> : null}
      <Card>
        <CardHeader
          title="Data yang kami pegang tentang Anda"
          subtitle="Salinan data dapat diminta dalam format mesin; penghapusan ditinjau dulu karena faktur pajak wajib disimpan 10 tahun."
        />
        <ul className="flex flex-col gap-2 text-[14px]">
          {overview.map((item) => (
            <li
              key={`${item.purpose}-${item.policyKey}`}
              className="rounded-card border border-border bg-canvas px-3 py-2"
            >
              <p className="font-semibold text-ink">{item.purpose}</p>
              <p className="mt-0.5 text-[13px] text-secondary">
                Kebijakan <code className="tnum">{item.policyKey}</code> v{item.policyVersion} ·
                status:{" "}
                {item.acceptedAt
                  ? `disetujui ${formatDateTime(item.acceptedAt)}`
                  : "belum ada persetujuan tercatat"}{" "}
                · sumber: {item.source}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Ajukan hak data pribadi"
            subtitle="Permintaan dicatat dan diproses manual oleh petugas (bukan otomatis)."
          />
          <form action={createPrivacyRequestAction} className="flex flex-col gap-3">
            <Field label="Jenis permintaan" htmlFor="kind" required>
              <select id="kind" name="kind" className="control" defaultValue="access">
                {Object.entries(PRIVACY_KIND_LABELS).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Detail"
              htmlFor="detail"
              required
              hint="Sebutkan data yang dimaksud dan cara penyampaian yang Anda inginkan."
            >
              <TextArea id="detail" name="detail" required rows={4} />
            </Field>
            <Button type="submit" size="sm">
              Kirim permintaan
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader
            title="Riwayat permintaan"
            subtitle={`${requests.length} permintaan tercatat`}
          />
          {requests.length === 0 ? (
            <p className="text-[14px] text-secondary">Belum ada permintaan.</p>
          ) : (
            <Table head={["Referensi", "Jenis", "Status", "Dibuat"]}>
              {requests.map((request) => (
                <Tr key={request.id}>
                  <Td label="Referensi">{request.reference}</Td>
                  <Td label="Jenis">{request.kindLabel}</Td>
                  <Td label="Status">{request.status}</Td>
                  <Td label="Dibuat">
                    {request.createdAt ? formatDateTime(request.createdAt) : "-"}
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
