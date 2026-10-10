import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/context";
import { hasPermission } from "@/server/context";
import { dashboardSummary, integrationStatus, listOutbox } from "@/server/services/admin.service";
import { formatDateTime, formatIDR } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, Td, Tr } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { runOutboxAction, runScheduledJobsAction } from "@/app/actions/admin";
import { SIMULATION_NOTE } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Admin - ringkasan",
  robots: { index: false, follow: false },
};

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ pesan?: string; err?: string }>;
}) {
  const query = await searchParams;
  const ctx = await requireStaffPage("/admin");
  const summary = await dashboardSummary(ctx, { days: 7 });
  const salesMax = Math.max(1, ...summary.salesByDay.map((row) => row.revenue));
  const canQueue = hasPermission(ctx, "integration.manage");
  const outbox = canQueue
    ? await listOutbox(ctx, { status: "failed", limit: 5 }).catch(() => null)
    : null;
  const integrations = await integrationStatus(ctx).catch(() => null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] leading-[32px]">Ringkasan 7 hari</h1>
          <p className="mt-1 text-[13px] text-secondary">
            Dihitung pada {formatDateTime(summary.generatedAt)} · angka berasal dari order, bukan
            perkiraan.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={runScheduledJobsAction}>
            <Button size="sm" variant="secondary" type="submit">
              Jalankan rekonsiliasi & kedaluwarsa
            </Button>
          </form>
          {canQueue ? (
            <form action={runOutboxAction}>
              <Button size="sm" variant="secondary" type="submit">
                Proses outbox
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {query.pesan ? <Alert tone="success">{query.pesan}</Alert> : null}
      {query.err ? <Alert tone="danger">{query.err}</Alert> : null}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.kpis.map((kpi) => (
          <li key={kpi.id}>
            <Card>
              <p className="label">{kpi.label}</p>
              <p className="tnum mt-1 text-[24px] font-bold leading-[32px]">{kpi.value}</p>
              <p className="hint mt-1">{kpi.note}</p>
            </Card>
          </li>
        ))}
      </ul>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader
            title="Peredaran harian"
            subtitle="Total nilai order yang dibayar per hari (IDR)."
          />
          {summary.salesByDay.length === 0 ? (
            <p className="text-[14px] text-secondary">
              Belum ada order dalam rentang ini. Jalankan seed untuk mengisi data contoh.
            </p>
          ) : (
            <ul className="flex h-[180px] items-end gap-2">
              {summary.salesByDay.map((row) => (
                <li key={row.day} className="flex flex-1 flex-col items-center gap-1">
                  <span className="tnum text-[11px] text-secondary">{formatIDR(row.revenue)}</span>
                  <span
                    className="w-full rounded-tile bg-brand"
                    style={{
                      height: `${Math.max(4, Math.round((row.revenue / salesMax) * 120))}px`,
                    }}
                    aria-hidden="true"
                  />
                  <span className="text-[11px] text-secondary">{row.orders} order</span>
                  <span className="text-[11px] font-semibold text-ink-soft">
                    {row.day.slice(5)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Antrean kerja" subtitle="Tumpukan yang perlu ditindak hari ini." />
          <ul className="flex flex-col gap-2">
            {summary.queues.map((queue) => (
              <li key={queue.id}>
                <Link
                  href={queue.href}
                  className="flex items-center justify-between gap-2 rounded-card border border-border px-3 py-2 text-[14px] hover:border-brand"
                >
                  <span className="font-semibold text-ink-soft">{queue.label}</span>
                  <Badge
                    tone={
                      (queue.tone === "danger"
                        ? "danger"
                        : queue.tone === "warning"
                          ? "warning"
                          : "neutral") as Tone
                    }
                  >
                    {queue.count}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Produk terlaris"
            subtitle="Berdasarkan unit terjual 7 hari terakhir."
          />
          {summary.topProducts.length === 0 ? (
            <p className="text-[14px] text-secondary">Belum ada penjualan.</p>
          ) : (
            <Table head={["Produk", "Unit", "Pendapatan"]}>
              {summary.topProducts.map((product) => (
                <Tr key={product.name}>
                  <Td label="Produk">{product.name}</Td>
                  <Td label="Unit" className="tnum">
                    {product.units}
                  </Td>
                  <Td label="Pendapatan" className="tnum">
                    {formatIDR(product.revenue)}
                  </Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Konektivitas" subtitle={SIMULATION_NOTE} />
          {integrations ? (
            <ul className="flex flex-col gap-2 text-[14px]">
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border px-3 py-2">
                <span className="font-semibold text-ink-soft">
                  Pembayaran · {integrations.payment.displayName}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={integrations.payment.isSimulated ? "warning" : "success"}>
                    {integrations.payment.isSimulated ? "simulasi" : "aktif"}
                  </Badge>
                  <span className="text-[12px] text-secondary">
                    {integrations.payment.unavailableReason ??
                      (integrations.payment.secretConfigured
                        ? "secret terpasang"
                        : "secret belum disetel")}
                  </span>
                </span>
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border px-3 py-2">
                <span className="font-semibold text-ink-soft">
                  Pengiriman · {integrations.shipping.displayName}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={integrations.shipping.isSimulated ? "warning" : "success"}>
                    {integrations.shipping.isSimulated ? "simulasi" : "aktif"}
                  </Badge>
                  <span className="text-[12px] text-secondary">
                    {integrations.shipping.unavailableReason ?? "tarif dari tabel simulasi"}
                  </span>
                </span>
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border px-3 py-2">
                <span className="font-semibold text-ink-soft">
                  Notifikasi · sink {integrations.notifications.sink}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={integrations.notifications.sink === "log" ? "warning" : "success"}>
                    {integrations.notifications.smtpConfigured ? "SMTP siap" : "tanpa kredensial"}
                  </Badge>
                  <span className="text-[12px] text-secondary">
                    Pesan masuk ke notification_outbox; tidak ada email nyata dikirim.
                  </span>
                </span>
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border px-3 py-2">
                <span className="font-semibold text-ink-soft">Antrean</span>
                <span className="tnum text-[12px] text-secondary">
                  outbox tertunda {integrations.counters.outboxPending} · notifikasi antre{" "}
                  {integrations.counters.notifyQueued} · webhook needs_review{" "}
                  {integrations.counters.needsReview} · signature salah{" "}
                  {integrations.counters.badSignatures}
                </span>
                <span className="block text-[12px] text-secondary">
                  Webhook terakhir:{" "}
                  {integrations.counters.lastWebhookAt
                    ? formatDateTime(integrations.counters.lastWebhookAt)
                    : "belum ada"}
                </span>
              </li>
            </ul>
          ) : (
            <p className="text-[14px] text-secondary">
              Status integrasi sedang tidak dapat dibaca.
            </p>
          )}
        </Card>
      </div>

      {outbox && outbox.length > 0 ? (
        <Card>
          <CardHeader
            title="Outbox gagal"
            subtitle="Butuh penanganan; tiap baris bisa di-retry dengan idempotency key."
          />
          <Table head={["Jenis", "Tujuan", "Percobaan", "Error", "Aksi"]}>
            {outbox.map((row) => (
              <Tr key={row.id}>
                <Td label="Jenis">{row.kind}</Td>
                <Td label="Tujuan">{row.destination}</Td>
                <Td label="Percobaan" className="tnum">
                  {row.attempts}/{row.maxAttempts}
                </Td>
                <Td label="Error">{row.lastError ?? "-"}</Td>
                <Td label="Aksi">
                  <form action={runOutboxAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <Button size="sm" variant="secondary" type="submit">
                      Retry
                    </Button>
                  </form>
                </Td>
              </Tr>
            ))}
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
