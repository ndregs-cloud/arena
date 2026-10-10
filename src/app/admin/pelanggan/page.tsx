import type { Metadata } from "next";
import Link from "next/link";
import { hasPermission, requireStaffPage } from "@/server/context";
import { listAdminUsers, listPrivacyRequests } from "@/server/services/admin.service";
import { PRIVACY_KIND_LABELS } from "@/server/services/account.service";
import { formatDate, formatDateTime } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, TextArea } from "@/components/ui/field";
import { Table, Td, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/state";
import { handlePrivacyRequestAction } from "@/app/actions/admin";

export const metadata: Metadata = {
  title: "Admin - pelanggan",
  robots: { index: false, follow: false },
};

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pesan?: string; err?: string }>;
}) {
  const query = await searchParams;
  const ctx = await requireStaffPage("/admin/pelanggan");
  const users = await listAdminUsers(ctx, { q: query.q, kind: "customer" });
  const canViewPrivacy = hasPermission(ctx, "customer.view");
  const requests = canViewPrivacy ? await listPrivacyRequests(ctx, {}).catch(() => []) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] leading-[32px]">Pelanggan</h1>
          <p className="mt-1 text-[13px] text-secondary">
            Data kontak ditampilkan penuh hanya untuk role dengan izin customer.pii.view; selain itu
            disembunyian service.
          </p>
        </div>
        <form method="get" action="/admin/pelanggan" className="flex items-end gap-2">
          <label className="flex min-w-[240px] flex-col gap-1">
            <span className="label">Cari email / nama</span>
            <input name="q" defaultValue={query.q ?? ""} className="control h-11" />
          </label>
          <button
            type="submit"
            className="min-h-[44px] rounded-control bg-brand px-4 text-[15px] font-semibold text-white"
          >
            Cari
          </button>
        </form>
      </div>

      {query.pesan ? <Alert tone="success">{query.pesan}</Alert> : null}
      {query.err ? <Alert tone="danger">{query.err}</Alert> : null}

      <Card>
        <CardHeader
          title={`Akun pelanggan (${users.rows.length})`}
          subtitle={`${users.total} total di basis data.`}
        />
        {users.rows.length === 0 ? (
          <EmptyState
            title="Tidak ada pelanggan"
            description="Akun terdaftar akan muncul di sini setelah pendaftaran pertama."
            icon="◇"
          />
        ) : (
          <Table head={["Pelanggan", "Kontak", "Aktivitas", "Status"]}>
            {users.rows.map((row) => (
              <Tr key={row.id}>
                <Td label="Pelanggan">
                  <span className="block font-semibold text-ink">{row.fullName}</span>
                  <span className="block text-[12px] text-secondary">
                    terdaftar {row.createdAt ? formatDate(row.createdAt) : "-"}
                  </span>
                </Td>
                <Td label="Kontak">
                  <span className="block">{row.email}</span>
                  <span className="block text-[12px] text-secondary">
                    {row.phone ?? "tanpa nomor"}
                  </span>
                </Td>
                <Td label="Aktivitas" className="text-[13px]">
                  {row.orderCount} pesanan
                  <span className="block text-[12px] text-secondary">
                    login terakhir{" "}
                    {row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "belum pernah"}
                  </span>
                </Td>
                <Td label="Status">
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={row.isActive ? "success" : "danger"}>
                      {row.isActive ? "aktif" : "nonaktif"}
                    </Badge>
                    {row.emailVerified ? (
                      <Badge tone="neutral">email verified</Badge>
                    ) : (
                      <Badge tone="warning">belum verified</Badge>
                    )}
                    <Link
                      href={`/admin/pesanan?q=${encodeURIComponent(row.email)}`}
                      className="text-[12px] font-semibold text-brand hover:underline"
                    >
                      lihat pesanan
                    </Link>
                  </span>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Permintaan hak data pribadi"
          subtitle="Diarsipkan & diproses manual; tidak ada penghapusan otomatis karena faktur wajib disimpan."
        />
        {!canViewPrivacy ? (
          <p className="text-[14px] text-secondary">
            Butuh izin customer.view untuk melihat daftar ini.
          </p>
        ) : requests.length === 0 ? (
          <p className="text-[14px] text-secondary">Belum ada permintaan masuk.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {requests.map((request) => (
              <li key={request.id} className="rounded-card border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[14px] font-semibold text-ink">
                      {request.reference} · {PRIVACY_KIND_LABELS[request.kind] ?? request.kind}
                    </p>
                    <p className="text-[12px] text-secondary">
                      {request.fullName} · {request.email} ·{" "}
                      {request.createdAt ? formatDateTime(request.createdAt) : "-"}
                    </p>
                  </div>
                  <Badge
                    tone={
                      request.status === "completed"
                        ? "success"
                        : request.status === "rejected"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {request.status}
                  </Badge>
                </div>
                {request.detail ? (
                  <p className="mt-2 text-[13px] leading-[19px] text-ink-soft">{request.detail}</p>
                ) : null}
                {hasPermission(ctx, "customer.view") &&
                request.status !== "completed" &&
                request.status !== "rejected" ? (
                  <form
                    action={handlePrivacyRequestAction}
                    className="mt-2 flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="id" value={request.id} />
                    <input type="hidden" name="backTo" value="/admin/pelanggan" />
                    <Field
                      label="Tindak lanjut"
                      htmlFor={`privacy-${request.id}`}
                      className="min-w-[240px] flex-1"
                    >
                      <TextArea
                        id={`privacy-${request.id}`}
                        name="note"
                        rows={1}
                        placeholder="Mis. salinan dikirim ke email terverifikasi"
                      />
                    </Field>
                    <Button
                      size="sm"
                      type="submit"
                      name="decision"
                      value="in_progress"
                      variant="secondary"
                    >
                      Tandai dikerjakan
                    </Button>
                    <Button
                      size="sm"
                      type="submit"
                      name="decision"
                      value="completed"
                      variant="success"
                    >
                      Selesaikan
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
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
