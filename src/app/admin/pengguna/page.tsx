import type { Metadata } from "next";
import { ROLES, ROLE_LABELS, ROLE_RESTRICTIONS } from "@/domain/rbac";
import { env } from "@/platform/env";
import { hasPermission, requireStaffPage } from "@/server/context";
import { listAdminUsers, listRoleMatrix } from "@/server/services/admin.service";
import { formatDateTime } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SelectInput, TextInput } from "@/components/ui/field";
import { Table, Td, Tr } from "@/components/ui/table";
import { assignRoleAction, revokeRoleAction, setUserActiveAction } from "@/app/actions/admin";

export const metadata: Metadata = {
  title: "Admin - pengguna & role",
  robots: { index: false, follow: false },
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; pesan?: string; err?: string }>;
}) {
  const query = await searchParams;
  const ctx = await requireStaffPage("/admin/pengguna");
  const canManage = hasPermission(ctx, "user.manage");
  const [users, matrix] = await Promise.all([
    listAdminUsers(ctx, { q: query.q, kind: query.kind }),
    listRoleMatrix(),
  ]);
  const roleOptions = ctx.user?.roles ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] leading-[32px]">Pengguna & role</h1>
          <p className="mt-1 text-[13px] text-secondary">
            Hak akses default-deny: role memberi izin, bukan nama orang. Perubahan dicatat di audit
            log.
          </p>
        </div>
        <form method="get" action="/admin/pengguna" className="flex items-end gap-2">
          <label className="flex min-w-[200px] flex-col gap-1">
            <span className="label">Cari</span>
            <TextInput
              name="q"
              defaultValue={query.q ?? ""}
              placeholder="email / nama"
              className="h-11"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Jenis</span>
            <select
              name="kind"
              defaultValue={query.kind ?? ""}
              className="control h-11 min-w-[150px]"
            >
              <option value="">Semua</option>
              <option value="staff">Staf</option>
              <option value="customer">Pelanggan</option>
            </select>
          </label>
          <button
            type="submit"
            className="min-h-[44px] rounded-control bg-brand px-4 text-[15px] font-semibold text-white"
          >
            Terapkan
          </button>
        </form>
      </div>

      {query.pesan ? <Alert tone="success">{query.pesan}</Alert> : null}
      {query.err ? <Alert tone="danger">{query.err}</Alert> : null}
      {!canManage ? (
        <Alert tone="warning" title="Hanya baca">
          Tanpa izin user.manage Anda tidak bisa menugaskan atau mencabut role.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title={`Daftar akun (${users.rows.length})`}
          subtitle={
            users.total > users.rows.length
              ? `${users.total} total, halaman ini ${users.rows.length}.`
              : undefined
          }
        />
        <Table head={["Akun", "Role", "Masuk terakhir", "Status", "Aksi"]}>
          {users.rows.map((row) => (
            <Tr key={row.id}>
              <Td label="Akun">
                <span className="block font-semibold text-ink">{row.fullName}</span>
                <span className="block text-[12px] text-secondary">
                  {row.email} · {row.kind === "staff" ? "staf" : "pelanggan"} · {row.orderCount}{" "}
                  pesanan
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {row.mfaEnabled ? (
                    <Badge tone="success">MFA</Badge>
                  ) : (
                    <Badge tone="warning">tanpa MFA</Badge>
                  )}
                  {row.emailVerified ? (
                    <Badge tone="neutral">email verified</Badge>
                  ) : (
                    <Badge tone="neutral">email belum verified</Badge>
                  )}
                </span>
              </Td>
              <Td label="Role">
                <ul className="flex flex-col gap-1">
                  {row.roles.length === 0 ? <li className="hint">belum ada role</li> : null}
                  {row.roles.map((role) => (
                    <li key={role} className="flex items-center gap-2 text-[13px]">
                      <span className="font-semibold">{ROLE_LABELS[role] ?? role}</span>
                      {canManage ? (
                        <form action={revokeRoleAction} className="inline">
                          <input type="hidden" name="userId" value={row.id} />
                          <input type="hidden" name="role" value={role} />
                          <button type="submit" className="text-[12px] text-danger hover:underline">
                            cabut
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Td>
              <Td label="Masuk terakhir" className="text-[13px]">
                {row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "belum pernah"}
              </Td>
              <Td label="Status">
                <Badge tone={row.isActive ? "success" : "danger"}>
                  {row.isActive ? "aktif" : "nonaktif"}
                </Badge>
              </Td>
              <Td label="Aksi">
                {canManage ? (
                  <form action={assignRoleAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="userId" value={row.id} />
                    <label className="flex flex-col gap-1">
                      <span className="hint">Role</span>
                      <SelectInput
                        name="role"
                        className="h-9 min-h-9 w-40"
                        defaultValue={roleOptions[0] ?? "customer"}
                      >
                        {ROLES.filter((role) =>
                          row.kind === "staff"
                            ? role !== "customer"
                            : role === "customer" || role === "manager",
                        ).map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role] ?? role}
                          </option>
                        ))}
                      </SelectInput>
                    </label>
                    <Button size="sm" type="submit" variant="secondary">
                      Tambah role
                    </Button>
                  </form>
                ) : null}
                {canManage ? (
                  <form
                    action={setUserActiveAction}
                    className="mt-2 flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="userId" value={row.id} />
                    <input
                      type="hidden"
                      name="reason"
                      value="Perubahan manual dari admin center."
                    />
                    <Button
                      size="sm"
                      type="submit"
                      name="isActive"
                      variant={row.isActive ? "danger" : "success"}
                      value={row.isActive ? "off" : "on"}
                    >
                      {row.isActive ? "Nonaktifkan akun" : "Aktifkan akun"}
                    </Button>
                  </form>
                ) : (
                  <span className="hint">-</span>
                )}
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Matriks role → izin"
            subtitle="Dibangun dari domain RBAC; tidak ada pengecualian per-user."
          />
          <Table head={["Role", "Izin"]}>
            {matrix.map((row) => (
              <Tr key={row.code}>
                <Td label="Role">
                  <span className="font-semibold">{row.label}</span>
                  <span className="block text-[12px] text-secondary">{row.description}</span>
                  {row.restriction ? (
                    <span className="mt-1 block text-[12px] text-warning">{row.restriction}</span>
                  ) : null}
                  <span className="mt-1 block text-[12px] text-secondary">
                    {row.userCount} akun memakai role ini
                  </span>
                </Td>
                <Td label="Izin">
                  <ul className="flex flex-wrap gap-1">
                    {row.permissions.map((permission) => (
                      <li key={permission}>
                        <Badge tone="neutral">{permission}</Badge>
                      </li>
                    ))}
                  </ul>
                </Td>
              </Tr>
            ))}
          </Table>
        </Card>

        <Card>
          <CardHeader
            title="Catatan keamanan"
            subtitle="Kebijakan yang ditegakkan service, bukan sekadar imbauan."
          />
          <ul className="flex flex-col gap-2 text-[14px] text-ink-soft">
            <li className="rounded-card border border-border bg-canvas px-3 py-2">
              Role hanya diberikan lewat halaman ini; tidak ada izin per-user yang dikecualikan.
            </li>
            <li className="rounded-card border border-border bg-canvas px-3 py-2">
              Staf diwajibkan memakai MFA bila REQUIRE_MFA_FOR_STAFF aktif (saat ini:{" "}
              {env.requireMfaForStaff ? "wajib" : "opsional"}).
            </li>
            <li className="rounded-card border border-border bg-canvas px-3 py-2">
              Kata sandi minimal 10 karakter, hash scrypt; percobaan masuk dibatasi per email + IP.
            </li>
            <li className="rounded-card border border-border bg-canvas px-3 py-2">
              {ROLE_RESTRICTIONS.merchandiser
                ? `Merchandiser: ${ROLE_RESTRICTIONS.merchandiser}`
                : "Merchandiser tidak menyentuh ledger pembayaran."}
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
