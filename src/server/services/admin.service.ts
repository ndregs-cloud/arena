import "server-only";
import { AppError } from "@/domain/errors";
import {
  PERMISSIONS,
  ROLES,
  ROLE_LABELS,
  ROLE_RESTRICTIONS,
  permissionsForRole,
  type Permission,
  type Role,
} from "@/domain/rbac";
import { getDb, bool, date, jsonb, num, optText, text } from "@/platform/db";
import { env } from "@/platform/env";
import { writeAudit } from "@/platform/audit";
import { dispatchNotifications } from "@/platform/notifications";
import { paymentProvider } from "@/platform/payment";
import { shippingProvider } from "@/platform/shipping";
import { requirePermission } from "@/server/context";
import type { RequestContext } from "@/server/context";
import { listAudit } from "@/platform/audit";
import { PRIVACY_KIND_LABELS, type PrivacyKind } from "@/server/services/account.service";
import { reconcileOpenAttempts } from "@/server/services/payment.service";
import { log } from "@/platform/logger";

/** Dashboard & pengaturan admin (Blueprint §6.4, §7.5, §8, §12.3). */

// ---------------------------------------------------------------------
// Site settings (whitelist; setiap kunci punya efek nyata di layer service)
// ---------------------------------------------------------------------

export interface SettingSpec {
  key: string;
  label: string;
  type: "integer" | "boolean" | "string" | "money";
  hint: string;
  defaultValue: unknown;
  min?: number;
  max?: number;
}

export const SETTING_SPECS: SettingSpec[] = [
  {
    key: "stock_adjustment_approval_threshold",
    label: "Ambang persetujuan penyesuaian stok",
    type: "money",
    hint: "Penyesuaian stok dengan nilai mutasi >= ambang ini dibuat sebagai permintaan dan harus disetujui aktor lain (maker-checker).",
    defaultValue: 1_000_000,
    min: 0,
    max: 1_000_000_000,
  },
  {
    key: "low_stock_threshold_default",
    label: "Ambang stok rendah default",
    type: "integer",
    hint: "Dipakai bila varian belum punya ambang sendiri; menandai stok rendah di admin Inventaris.",
    defaultValue: env.lowStockDefault,
    min: 0,
    max: 10_000,
  },
  {
    key: "store_notice",
    label: "Pengumuman di beranda",
    type: "string",
    hint: "Teks singkat yang tampil sebagai banner informasi di beranda. Kosongkan untuk menyembunyikan.",
    defaultValue: "",
    max: 240,
  },
  {
    key: "support_contact",
    label: "Kontak layanan pelanggan",
    type: "string",
    hint: "Ditampilkan di footer, halaman bantuan, dan detail pesanan.",
    defaultValue: "halo@ndre.gstore.example",
    max: 160,
  },
  {
    key: "maintenance_mode",
    label: "Mode pemeliharaan",
    type: "boolean",
    hint: "Bila aktif, storefront non-staf menerima halaman pemeliharaan; admin tetap dapat masuk.",
    defaultValue: false,
  },
];

const SETTINGS_BY_KEY = new Map(SETTING_SPECS.map((s) => [s.key, s]));

async function readSettingsRaw(): Promise<Record<string, unknown>> {
  const db = await getDb();
  const res = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM site_settings`,
  );
  const out: Record<string, unknown> = {};
  for (const row of res.rows) out[row.key] = jsonb<Record<string, unknown>>(row.value, {}).value;
  return out;
}

export async function getSiteSettings(): Promise<
  Array<SettingSpec & { value: unknown; isOverridden: boolean }>
> {
  const raw = await readSettingsRaw();
  return SETTING_SPECS.map((spec) => ({
    ...spec,
    value: raw[spec.key] === undefined ? spec.defaultValue : raw[spec.key],
    isOverridden: raw[spec.key] !== undefined,
  }));
}

export async function getSetting<T = unknown>(key: string): Promise<T> {
  const spec = SETTINGS_BY_KEY.get(key);
  const raw = await readSettingsRaw();
  return (raw[key] === undefined ? (spec?.defaultValue ?? null) : raw[key]) as T;
}

export async function updateSiteSettings(
  ctx: RequestContext,
  patch: Record<string, unknown>,
): Promise<{ message: string; changed: string[] }> {
  requirePermission(ctx, "settings.manage");
  const db = await getDb();
  const changed: string[] = [];
  for (const [key, rawValue] of Object.entries(patch)) {
    const spec = SETTINGS_BY_KEY.get(key);
    if (!spec)
      throw new AppError(
        "VALIDATION_FAILED",
        `Pengaturan '${key}' tidak dapat diubah dari layar ini.`,
        { status: 422 },
      );
    let value: unknown;
    if (spec.type === "integer" || spec.type === "money") {
      const n = Math.trunc(Number(rawValue));
      if (!Number.isFinite(n))
        throw new AppError("VALIDATION_FAILED", `${spec.label} harus angka.`, { status: 422 });
      if (spec.min !== undefined && n < spec.min)
        throw new AppError("VALIDATION_FAILED", `${spec.label} minimal ${spec.min}.`, {
          status: 422,
        });
      if (spec.max !== undefined && n > spec.max)
        throw new AppError("VALIDATION_FAILED", `${spec.label} maksimal ${spec.max}.`, {
          status: 422,
        });
      value = n;
    } else if (spec.type === "boolean") {
      value = rawValue === true || rawValue === "true" || rawValue === "on" || rawValue === 1;
    } else {
      value = String(rawValue ?? "")
        .trim()
        .slice(0, spec.max ?? 500);
    }
    const before = await db.query<{ value: unknown }>(
      `SELECT value FROM site_settings WHERE key = $1`,
      [key],
    );
    await db.query(
      `INSERT INTO site_settings (key, value, description, updated_by, updated_at)
       VALUES ($1,$2::jsonb,$3,$4,now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, JSON.stringify({ value }), spec.hint, ctx.user?.id ?? null],
    );
    await writeAudit({
      actorId: ctx.user?.id,
      actorEmail: ctx.user?.email,
      action: "settings.update",
      targetType: "site_setting",
      targetId: key,
      beforeData: before.rows[0]
        ? { value: jsonb<Record<string, unknown>>(before.rows[0].value, {}).value }
        : null,
      afterData: { value },
      requestId: ctx.requestId,
    });
    changed.push(spec.label);
  }
  return {
    message: changed.length
      ? `Pengaturan disimpan: ${changed.join(", ")}.`
      : "Tidak ada perubahan.",
    changed,
  };
}

// ---------------------------------------------------------------------
// Pengguna & peran
// ---------------------------------------------------------------------

export interface AdminUserRow {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  kind: "customer" | "staff";
  isActive: boolean;
  roles: Role[];
  roleLabels: string[];
  mfaEnabled: boolean;
  emailVerified: boolean;
  lastLoginAt: Date | null;
  createdAt: Date | null;
  orderCount: number;
}

export async function listAdminUsers(
  ctx: RequestContext,
  filters: { q?: string; kind?: string; page?: number } = {},
): Promise<{ rows: AdminUserRow[]; total: number; page: number }> {
  requirePermission(ctx, "user.manage");
  const db = await getDb();
  const page = Math.max(1, filters.page ?? 1);
  const perPage = 25;
  const params: unknown[] = [
    filters.q ? `%${filters.q.toLowerCase()}%` : null,
    filters.kind ?? null,
  ];
  const countRes = await db.query<{ c: unknown }>(
    `SELECT count(*)::int AS c FROM users u
      WHERE ($1::text IS NULL OR lower(u.email) LIKE $1 OR lower(u.full_name) LIKE $1)
        AND ($2::text IS NULL OR u.kind = $2)`,
    params,
  );
  const res = await db.query<Record<string, unknown>>(
    `SELECT u.*, COALESCE(r.roles, '[]'::jsonb) AS roles_json,
            (SELECT count(*)::int FROM orders o WHERE o.customer_id = u.id) AS order_count
       FROM users u
       LEFT JOIN LATERAL (SELECT jsonb_agg(ur.role_code ORDER BY ur.role_code) AS roles FROM user_roles ur WHERE ur.user_id = u.id) r ON true
      WHERE ($1::text IS NULL OR lower(u.email) LIKE $1 OR lower(u.full_name) LIKE $1)
        AND ($2::text IS NULL OR u.kind = $2)
      ORDER BY u.created_at DESC
      LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
    params,
  );
  return {
    rows: res.rows.map((row) => {
      const roles = jsonb<string[]>(row.roles_json, []) as Role[];
      return {
        id: text(row.id),
        email: text(row.email),
        fullName: text(row.full_name),
        phone: optText(row.phone),
        kind: text(row.kind, "customer") as "customer" | "staff",
        isActive: bool(row.is_active),
        roles,
        roleLabels: roles.map((r) => ROLE_LABELS[r] ?? r),
        mfaEnabled: Boolean(row.mfa_enabled_at),
        emailVerified: Boolean(row.email_verified_at),
        lastLoginAt: date(row.last_login_at),
        createdAt: date(row.created_at),
        orderCount: num(row.order_count),
      };
    }),
    total: num(countRes.rows[0]?.c),
    page,
  };
}

export async function assignUserRole(
  ctx: RequestContext,
  userId: string,
  roleCode: Role,
): Promise<{ message: string }> {
  requirePermission(ctx, "user.role.assign");
  const db = await getDb();
  const user = await db.query<Record<string, unknown>>(
    `SELECT id, kind, email FROM users WHERE id = $1`,
    [userId],
  );
  if (!user.rows[0]) throw new AppError("NOT_FOUND", "Pengguna tidak ditemukan.", { status: 404 });
  if (!ROLES.includes(roleCode))
    throw new AppError("VALIDATION_FAILED", "Peran tidak dikenali.", { status: 422 });
  if (String(user.rows[0].kind) === "customer" && roleCode !== "customer") {
    throw new AppError(
      "VALIDATION_FAILED",
      "Akun pelanggan tidak dapat diberi peran staf. Ubah jenis akun terlebih dahulu.",
      { status: 422 },
    );
  }
  await db.query(
    `INSERT INTO user_roles (user_id, role_code, granted_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [userId, roleCode, ctx.user?.id ?? null],
  );
  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: "user.role_assign",
    targetType: "user",
    targetId: userId,
    afterData: { roleCode },
    reason: `Menambahkan peran ${ROLE_LABELS[roleCode] ?? roleCode} untuk ${text(user.rows[0].email)}`,
    requestId: ctx.requestId,
  });
  return { message: `Peran ${ROLE_LABELS[roleCode] ?? roleCode} dipasang.` };
}

export async function revokeUserRole(
  ctx: RequestContext,
  userId: string,
  roleCode: Role,
): Promise<{ message: string }> {
  requirePermission(ctx, "user.role.assign");
  const db = await getDb();
  if (ctx.user?.id === userId && roleCode === "system_admin") {
    throw new AppError(
      "VALIDATION_FAILED",
      "Anda tidak dapat mencabut peran administrator dari akun sendiri.",
      { status: 422 },
    );
  }
  await db.query(`DELETE FROM user_roles WHERE user_id = $1 AND role_code = $2`, [
    userId,
    roleCode,
  ]);
  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: "user.role_revoke",
    targetType: "user",
    targetId: userId,
    beforeData: { roleCode },
    reason: `Mencabut peran ${ROLE_LABELS[roleCode] ?? roleCode}`,
    requestId: ctx.requestId,
  });
  return { message: "Peran dicabut. Perubahan berlaku pada permintaan berikutnya." };
}

export async function setUserActivation(
  ctx: RequestContext,
  userId: string,
  active: boolean,
  reason: string,
): Promise<{ message: string }> {
  requirePermission(ctx, "user.manage");
  if (!reason || reason.trim().length < 5)
    throw new AppError("VALIDATION_FAILED", "Alasan wajib diisi (minimal 5 karakter).", {
      status: 422,
    });
  if (ctx.user?.id === userId)
    throw new AppError("VALIDATION_FAILED", "Anda tidak dapat menonaktifkan akun sendiri.", {
      status: 422,
    });
  const db = await getDb();
  await db.query(`UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1`, [
    userId,
    active,
  ]);
  if (!active)
    await db.query(
      `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: active ? "user.activate" : "user.deactivate",
    targetType: "user",
    targetId: userId,
    beforeData: { is_active: !active },
    afterData: { is_active: active },
    reason: reason.trim(),
    requestId: ctx.requestId,
  });
  return {
    message: active ? "Akun diaktifkan kembali." : "Akun dinonaktifkan dan semua sesinya dicabut.",
  };
}

export async function listRoleMatrix(): Promise<
  Array<{
    code: Role;
    label: string;
    description: string;
    permissions: Permission[];
    restriction: string | null;
    userCount: number;
  }>
> {
  const db = await getDb();
  const counts = await db.query<Record<string, unknown>>(
    `SELECT role_code, count(*)::int AS c FROM user_roles GROUP BY role_code`,
  );
  const byRole = new Map(counts.rows.map((r) => [text(r.role_code), num(r.c)]));
  const descriptions = await db.query<Record<string, unknown>>(
    `SELECT code, description FROM roles`,
  );
  const descByRole = new Map(
    descriptions.rows.map((r) => [text(r.code), optText(r.description) ?? ""]),
  );
  return ROLES.map((code) => ({
    code,
    label: ROLE_LABELS[code],
    description: descByRole.get(code) ?? "",
    permissions: [...permissionsForRole(code)],
    restriction: ROLE_RESTRICTIONS[code] ?? null,
    userCount: byRole.get(code) ?? 0,
  }));
}

export function allPermissionsGrouped(): Array<{
  group: string;
  items: Array<{ code: Permission; label: string }>;
}> {
  const groups = new Map<string, Array<{ code: Permission; label: string }>>();
  for (const code of PERMISSIONS) {
    const group = code.split(".")[0] ?? "lain";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({ code, label: code.replace(".", " · ") });
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

// ---------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------

export interface DashboardSummary {
  range: { from: Date; to: Date };
  kpis: Array<{
    id: string;
    label: string;
    value: string;
    numeric: number;
    note: string;
    tone: "default" | "positive" | "warning" | "danger";
  }>;
  salesByDay: Array<{ day: string; orders: number; revenue: number }>;
  topProducts: Array<{ name: string; units: number; revenue: number }>;
  queues: Array<{
    id: string;
    label: string;
    count: number;
    href: string;
    tone: "default" | "warning" | "danger";
  }>;
  integrations: Array<{
    name: string;
    status: "simulasi" | "siap" | "belum dikonfigurasi";
    detail: string;
  }>;
  generatedAt: Date;
}

export async function dashboardSummary(
  ctx: RequestContext,
  params: { days?: number } = {},
): Promise<DashboardSummary> {
  requirePermission(ctx, "report.view");
  const db = await getDb();
  const days = Math.min(90, Math.max(1, params.days ?? 7));
  const from = new Date(Date.now() - days * 86_400_000);
  const kpi = await db.query<Record<string, unknown>>(
    `SELECT
       (SELECT count(*)::int FROM orders o WHERE o.created_at >= $1) AS orders_count,
       (SELECT COALESCE(SUM(o.total_amount),0)::bigint FROM orders o WHERE o.created_at >= $1 AND o.payment_status = 'succeeded') AS revenue,
       (SELECT count(*)::int FROM orders o WHERE o.created_at >= $1 AND o.payment_status = 'succeeded') AS paid_count,
       (SELECT count(*)::int FROM orders o WHERE o.status = 'pending_payment') AS awaiting_payment,
       (SELECT count(*)::int FROM orders o WHERE o.payment_status = 'succeeded' AND o.fulfillment_status = 'unfulfilled' AND o.status IN ('paid','on_hold')) AS to_fulfil,
       (SELECT count(*)::int FROM orders o WHERE o.status = 'return_requested') AS return_requests,
       (SELECT COALESCE(SUM(oi.quantity),0)::int FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.created_at >= $1) AS units_sold,
       (SELECT count(*)::int FROM inventory_balances WHERE available <= GREATEST(safety_stock, $2::int)) AS low_stock,
       (SELECT count(*)::int FROM returns r WHERE r.status NOT IN ('resolved','rejected','cancelled')) AS open_returns,
       (SELECT count(*)::int FROM refunds rf WHERE rf.status = 'approved') AS refunds_to_send,
       (SELECT count(*)::int FROM stock_adjustment_requests WHERE status = 'pending') AS stock_approvals,
       (SELECT count(*)::int FROM integration_outbox WHERE status IN ('pending','failed')) AS outbox_backlog,
       (SELECT count(*)::int FROM payment_webhook_events WHERE status = 'needs_review') AS webhook_exceptions,
       (SELECT count(*)::int FROM products WHERE status = 'published') AS published_products,
       (SELECT count(*)::int FROM products WHERE status = 'draft') AS draft_products,
       (SELECT max(updated_at) FROM orders) AS last_order_update`,
    [from.toISOString(), env.lowStockDefault],
  );
  const row = kpi.rows[0] ?? {};
  const revenue = num(row.revenue);
  const ordersCount = num(row.orders_count);
  const paidCount = num(row.paid_count);

  const salesRes = await db.query<Record<string, unknown>>(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(o.orders,0)::int AS orders, COALESCE(o.revenue,0)::bigint AS revenue
       FROM generate_series(date_trunc('day', now()) - ($1 || ' days')::interval, date_trunc('day', now()), interval '1 day') d(day)
       LEFT JOIN (
         SELECT date_trunc('day', o.created_at) AS day, count(*)::int AS orders, sum(o.total_amount)::bigint AS revenue
           FROM orders o WHERE o.created_at >= now() - ($1 || ' days')::interval GROUP BY 1
       ) o ON o.day = d.day
      ORDER BY d.day`,
    [String(days - 1)],
  );

  const topRes = await db.query<Record<string, unknown>>(
    `SELECT oi.name_snapshot AS name, sum(oi.quantity)::int AS units, sum(oi.line_total_amount)::bigint AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= $1 AND o.payment_status = 'succeeded'
      GROUP BY oi.name_snapshot ORDER BY units DESC LIMIT 5`,
    [from.toISOString()],
  );

  const payment = paymentProvider();
  const shipping = shippingProvider();
  const integrations: DashboardSummary["integrations"] = [
    {
      name: `Pembayaran (${payment.code})`,
      status: payment.isSimulated ? "simulasi" : "siap",
      detail:
        payment.unavailableReason() ??
        "Adapter aktif. Webhook diverifikasi dengan secret penyedia; status 'lunas' hanya dari webhook/rekap penyedia.",
    },
    {
      name: `Pengiriman (${shipping.code})`,
      status: shipping.isSimulated ? "simulasi" : "siap",
      detail:
        shipping.unavailableReason() ??
        "Tarif & resi dari adapter pengiriman. Tarif pada layar tetap diberi label simulasi hingga tarif resmi terhubung.",
    },
    {
      name: `Notifikasi email (${env.notifySink})`,
      status: env.notifySink === "smtp" ? "siap" : "simulasi",
      detail:
        env.notifySink === "smtp"
          ? "Sinkronisasi lewat SMTP yang dikonfigurasi pada environment."
          : "SMTP belum diisi; pesan masuk antrean dan tercatat di log (tidak dikirim keluar).",
    },
    {
      name: `Database (${env.dataDriver})`,
      status: env.isEmbeddedDatabase ? "simulasi" : "siap",
      detail: env.isEmbeddedDatabase
        ? "Engine dev tertanam (pglite) untuk verifikasi lokal; produksi memakai PostgreSQL/Supabase lewat DATABASE_URL."
        : "PostgreSQL eksternal terhubung.",
    },
  ];

  return {
    range: { from, to: new Date() },
    kpis: [
      {
        id: "revenue",
        label: `Pendapatan ${days} hari`,
        value: `Rp ${revenue.toLocaleString("id-ID")}`,
        numeric: revenue,
        note: "Hanya order dengan pembayaran terkonfirmasi",
        tone: "positive",
      },
      {
        id: "orders",
        label: "Pesanan",
        value: String(ordersCount),
        numeric: ordersCount,
        note: `Dibuat dalam ${days} hari terakhir`,
        tone: "default",
      },
      {
        id: "aov",
        label: "Nilai rata-rata pesanan",
        value: `Rp ${(paidCount > 0 ? Math.round(revenue / paidCount) : 0).toLocaleString("id-ID")}`,
        numeric: paidCount > 0 ? Math.round(revenue / paidCount) : 0,
        note: "Rata-rata order terbayar",
        tone: "default",
      },
      {
        id: "awaiting",
        label: "Menunggu pembayaran",
        value: String(num(row.awaiting_payment)),
        numeric: num(row.awaiting_payment),
        note: `Batas bayar ${env.paymentTimeoutMinutes} menit`,
        tone: "warning",
      },
      {
        id: "to_fulfil",
        label: "Perlu diproses",
        value: String(num(row.to_fulfil)),
        numeric: num(row.to_fulfil),
        note: "Sudah dibayar, belum diserahkan ke kurir",
        tone: "warning",
      },
      {
        id: "low_stock",
        label: "Stok rendah",
        value: String(num(row.low_stock)),
        numeric: num(row.low_stock),
        note: "Termasuk di bawah safety stock",
        tone: num(row.low_stock) > 0 ? "danger" : "default",
      },
      {
        id: "returns",
        label: "Retur terbuka",
        value: String(num(row.open_returns)),
        numeric: num(row.open_returns),
        note: `${num(row.return_requests)} menunggu keputusan`,
        tone: "warning",
      },
      {
        id: "refunds",
        label: "Refund siap dikirim",
        value: String(num(row.refunds_to_send)),
        numeric: num(row.refunds_to_send),
        note: "Butuh pengiriman ke penyedia/ledger",
        tone: "default",
      },
      {
        id: "approvals",
        label: "Persetujuan tertunda",
        value: String(num(row.stock_approvals)),
        numeric: num(row.stock_approvals),
        note: "Maker-checker stok & promosi",
        tone: num(row.stock_approvals) > 0 ? "warning" : "default",
      },
      {
        id: "outbox",
        label: "Antrean integrasi",
        value: String(num(row.outbox_backlog)),
        numeric: num(row.outbox_backlog),
        note: `${num(row.webhook_exceptions) === 0 ? "tanpa" : num(row.webhook_exceptions)} webhook perlu tinjau`,
        tone: num(row.webhook_exceptions) > 0 ? "danger" : "default",
      },
    ],
    salesByDay: salesRes.rows.map((r) => ({
      day: text(r.day),
      orders: num(r.orders),
      revenue: num(r.revenue),
    })),
    topProducts: topRes.rows.map((r) => ({
      name: text(r.name),
      units: num(r.units),
      revenue: num(r.revenue),
    })),
    queues: [
      {
        id: "to_fulfil",
        label: "Pesanan siap diproses",
        count: num(row.to_fulfil),
        href: "/admin/pesanan?payment=succeeded&fulfillment=unfulfilled",
        tone: "warning",
      },
      {
        id: "return_requests",
        label: "Pengajuan retur baru",
        count: num(row.return_requests),
        href: "/admin/retur?status=requested",
        tone: "warning",
      },
      {
        id: "stock_approvals",
        label: "Penyesuaian stok menunggu approval",
        count: num(row.stock_approvals),
        href: "/admin/inventaris?tab=approval",
        tone: num(row.stock_approvals) > 0 ? "danger" : "default",
      },
      {
        id: "refunds_to_send",
        label: "Refund disetujui, belum dikirim",
        count: num(row.refunds_to_send),
        href: "/admin/pesanan?tab=refund",
        tone: "default",
      },
      {
        id: "webhook_exceptions",
        label: "Webhook perlu ditinjau",
        count: num(row.webhook_exceptions),
        href: "/admin/audit?target=payment",
        tone: num(row.webhook_exceptions) > 0 ? "danger" : "default",
      },
      {
        id: "draft_products",
        label: "Produk masih draft",
        count: num(row.draft_products),
        href: "/admin/katalog?status=draft",
        tone: "default",
      },
    ],
    integrations,
    generatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------
// Outbox (retry/backoff + retry-safe, Blueprint §8.2)
// ---------------------------------------------------------------------

const DEFERRED_KINDS: Record<string, string> = {
  "fulfilment.pick":
    "Integrasi WMS/ERP belum aktif pada rilis ini; proses picking dilakukan manual dari layar Pesanan.",
  "review.moderate": "Catatan internal moderasi ulasan; tidak ada tindakan sistem eksternal.",
};

export async function listOutbox(
  ctx: RequestContext,
  filters: { status?: string; limit?: number } = {},
) {
  requirePermission(ctx, "integration.manage");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT id, kind, destination, status, attempts, max_attempts, next_run_at, last_error, idempotency_key, created_at, finished_at, payload
       FROM integration_outbox
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY CASE status WHEN 'failed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, next_run_at
      LIMIT $2`,
    [filters.status ?? null, Math.min(200, filters.limit ?? 50)],
  );
  return res.rows.map((row) => ({
    id: num(row.id),
    kind: text(row.kind),
    destination: text(row.destination),
    status: text(row.status),
    attempts: num(row.attempts),
    maxAttempts: num(row.max_attempts),
    nextRunAt: date(row.next_run_at),
    lastError: optText(row.last_error),
    idempotencyKey: text(row.idempotency_key),
    createdAt: date(row.created_at),
    finishedAt: date(row.finished_at),
    payload: jsonb<Record<string, unknown>>(row.payload, {}),
  }));
}

type OutboxDb = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

async function markOutbox(db: OutboxDb, id: number, status: string, error?: string): Promise<void> {
  if (status === "succeeded") {
    await db.query(
      `UPDATE integration_outbox SET status='succeeded', finished_at=now(), last_error=NULL WHERE id=$1`,
      [id],
    );
    return;
  }
  const row = await db.query(`SELECT attempts, max_attempts FROM integration_outbox WHERE id=$1`, [
    id,
  ]);
  const attempts = num(row.rows[0]?.attempts) + 1;
  const max = num(row.rows[0]?.max_attempts, 8) || 8;
  const final = attempts >= max ? "dead_letter" : "failed";
  await db.query(
    `UPDATE integration_outbox SET status=$2, attempts=$3, last_error=$4, next_run_at = now() + ($5 || ' minutes')::interval, finished_at = CASE WHEN $2 <> 'failed' THEN now() ELSE NULL END WHERE id=$1`,
    [
      id,
      final,
      attempts,
      error ?? "tidak ada detail error",
      String(Math.min(240, 2 ** Math.min(attempts, 8) * 5)),
    ],
  );
}

export interface OutboxProcessResult {
  processed: number;
  succeeded: number;
  failed: number;
  deferred: number;
  messages: string[];
}

/** Jalankan antrean integrasi sekali (dipanggil cron/API admin). Idempotent: klaim FOR UPDATE SKIP LOCKED. */
export async function processOutbox(ctx: RequestContext, limit = 20): Promise<OutboxProcessResult> {
  requirePermission(ctx, "integration.manage");
  const db = await getDb();
  const result: OutboxProcessResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    deferred: 0,
    messages: [],
  };
  const due = await db.query<Record<string, unknown>>(
    `SELECT id, kind, destination, payload, idempotency_key, status FROM integration_outbox
      WHERE status IN ('pending','failed') AND next_run_at <= now()
      ORDER BY next_run_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [Math.min(100, Math.max(1, limit))],
  );
  for (const item of due.rows) {
    const id = num(item.id);
    const kind = text(item.kind);
    const payload = jsonb<Record<string, unknown>>(item.payload, {});
    await db.query(
      `UPDATE integration_outbox SET status='running', attempts = attempts + 1 WHERE id=$1`,
      [id],
    );
    result.processed += 1;
    try {
      if (DEFERRED_KINDS[kind]) {
        await markOutbox(db, id, "succeeded");
        result.deferred += 1;
        result.succeeded += 1;
        result.messages.push(
          `#${id} ${kind}: dicatat, tanpa tindakan eksternal (${DEFERRED_KINDS[kind]})`,
        );
        continue;
      }
      if (kind === "order.notify") {
        const orderId = optText(payload.orderId) ?? optText(payload.order_id);
        const to = text(payload.to ?? "");
        if (!orderId || !to) throw new Error("payload tidak lengkap");
        const orderRes = await db.query<Record<string, unknown>>(
          `SELECT order_number, status FROM orders WHERE id=$1`,
          [orderId],
        );
        if (!orderRes.rows[0]) throw new Error("order tidak ditemukan");
        await db.query(
          `INSERT INTO notification_outbox (kind, channel, to_address, subject, body, template, template_version, order_id, payload, requires_consent, status)
           VALUES ('order_status','email',$2,'Status pesanan ${text(orderRes.rows[0].order_number)} diperbarui',$3,'order_status',1,$4,'{}'::jsonb,false,'queued')
           ON CONFLICT DO NOTHING`,
          [
            kind,
            to,
            `Pesanan ${text(orderRes.rows[0].order_number)} kini berstatus ${text(orderRes.rows[0].status)}.`,
            orderId,
          ],
        );
        await markOutbox(db, id, "succeeded");
        result.succeeded += 1;
        result.messages.push(`#${id} order.notify: notifikasi status diantrekan`);
        continue;
      }
      if (kind === "payment.exception") {
        const summary = await reconcileOpenAttempts(20);
        if (summary.settled > 0) {
          await markOutbox(db, id, "succeeded");
          result.succeeded += 1;
          result.messages.push(
            `#${id} payment.exception: rekonsiliasi otomatis menyelesaikan ${summary.settled} pembayaran`,
          );
        } else {
          await markOutbox(
            db,
            id,
            "failed",
            `Rekonsiliasi belum menemukan pasangan (diperiksa: ${summary.checked}, perlu tinjau: ${summary.exceptions}).`,
          );
          result.failed += 1;
          result.messages.push(`#${id} payment.exception: masih perlu tinjauan manual`);
        }
        continue;
      }
      if (kind === "refund.request") {
        await markOutbox(
          db,
          id,
          "failed",
          "Menunggu tindakan manual: keuangan membuat/mengirim refund dari layar Pesanan (ledger refund).",
        );
        result.failed += 1;
        result.messages.push(`#${id} refund.request: butuh tindakan manual keuangan`);
        continue;
      }
      await markOutbox(
        db,
        id,
        "failed",
        `Jenis antrean '${kind}' belum punya penangan di rilis ini.`,
      );
      result.failed += 1;
      result.messages.push(`#${id} ${kind}: tidak ada penangan, dicoba ulang dengan backoff`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markOutbox(db, id, "failed", message);
      result.failed += 1;
      result.messages.push(`#${id} ${kind}: ${message}`);
      log.warn("outbox item gagal", { id, kind, message });
    }
  }
  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: "integration.outbox_process",
    targetType: "integration_outbox",
    afterData: { processed: result.processed, succeeded: result.succeeded, failed: result.failed },
    requestId: ctx.requestId,
  });
  return result;
}

export async function retryOutboxItem(
  ctx: RequestContext,
  id: number,
): Promise<{ message: string }> {
  requirePermission(ctx, "integration.manage");
  const db = await getDb();
  const res = await db.query<{ status: string }>(
    `UPDATE integration_outbox SET status='pending', next_run_at = now(), attempts = 0, last_error = NULL WHERE id=$1 RETURNING status`,
    [id],
  );
  if (!res.rows[0])
    throw new AppError("NOT_FOUND", "Item antrean tidak ditemukan.", { status: 404 });
  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: "integration.retry",
    targetType: "integration_outbox",
    targetId: String(id),
    reason: "percobaan ulang manual",
    requestId: ctx.requestId,
  });
  return { message: "Item dikembalikan ke antrean dan akan dicoba pada jalurnya berikutnya." };
}

export async function runNotificationQueue(ctx: RequestContext, limit = 25) {
  requirePermission(ctx, "integration.manage");
  const result = await dispatchNotifications(limit);
  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: "integration.notify_dispatch",
    targetType: "notification_outbox",
    afterData: { ...result },
    requestId: ctx.requestId,
  });
  return result;
}

export async function integrationStatus(ctx: RequestContext) {
  requirePermission(ctx, "integration.manage");
  const payment = paymentProvider();
  const shipping = shippingProvider();
  const db = await getDb();
  const stats = await db.query<Record<string, unknown>>(
    `SELECT (SELECT count(*)::int FROM payment_webhook_events WHERE signature_valid = false) AS bad_signatures,
            (SELECT count(*)::int FROM payment_webhook_events WHERE status = 'needs_review') AS needs_review,
            (SELECT max(received_at) FROM payment_webhook_events) AS last_webhook_at,
            (SELECT count(*)::int FROM notification_outbox WHERE status IN ('queued','failed')) AS notify_queued,
            (SELECT count(*)::int FROM integration_outbox WHERE status IN ('pending','failed')) AS outbox_pending`,
    [],
  );
  return {
    payment: {
      code: payment.code,
      displayName: payment.displayName,
      isSimulated: payment.isSimulated,
      unavailableReason: payment.unavailableReason(),
      secretConfigured: Boolean(
        process.env.MOCK_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET,
      ),
    },
    shipping: {
      code: shipping.code,
      displayName: shipping.displayName,
      isSimulated: shipping.isSimulated,
      unavailableReason: shipping.unavailableReason(),
    },
    notifications: { sink: env.notifySink, smtpConfigured: Boolean(process.env.SMTP_URL) },
    counters: {
      badSignatures: num(stats.rows[0]?.bad_signatures),
      needsReview: num(stats.rows[0]?.needs_review),
      lastWebhookAt: date(stats.rows[0]?.last_webhook_at),
      notifyQueued: num(stats.rows[0]?.notify_queued),
      outboxPending: num(stats.rows[0]?.outbox_pending),
    },
    requireMfaForStaff: env.requireMfaForStaff,
    driver: env.dataDriver,
  };
}

// ---------------------------------------------------------------------
// Audit & kebijakan
// ---------------------------------------------------------------------

export async function searchAudit(
  ctx: RequestContext,
  filters: {
    targetType?: string;
    targetId?: string;
    actorId?: string;
    limit?: number;
    cursor?: number;
  },
) {
  requirePermission(ctx, "audit.view");
  const { rows, nextCursor } = await listAudit({
    ...filters,
    limit: Math.min(200, filters.limit ?? 50),
  });
  return {
    rows: rows.map((row) => ({
      id: num(row.id),
      actorEmail: optText(row.actor_email) ?? "sistem",
      actorKind: text(row.actor_kind, "system"),
      action: text(row.action),
      targetType: text(row.target_type),
      targetId: optText(row.target_id),
      reason: optText(row.reason),
      requestId: optText(row.request_id),
      createdAt: date(row.created_at),
      before: jsonb<Record<string, unknown> | null>(row.before_data, null),
      after: jsonb<Record<string, unknown> | null>(row.after_data, null),
    })),
    nextCursor: nextCursor ? Number(nextCursor) : null,
  };
}

export async function listPoliciesForAdmin(ctx: RequestContext) {
  requirePermission(ctx, "content.manage");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT key, version, title, effective_at, is_current, length(body) AS body_length, created_by
       FROM policies ORDER BY key, version DESC`,
    [],
  );
  return res.rows.map((row) => ({
    key: text(row.key),
    version: num(row.version),
    title: text(row.title),
    effectiveAt: date(row.effective_at),
    isCurrent: bool(row.is_current),
    bodyLength: num(row.body_length),
  }));
}

/** Terbitkan versi kebijakan baru (versi lama tetap tersimpan; order memakai snapshot versi). */
export async function publishPolicy(
  ctx: RequestContext,
  input: { key: string; title: string; body: string },
): Promise<{ version: number; message: string }> {
  requirePermission(ctx, "content.manage");
  const key = input.key.trim();
  if (!/^[a-z0-9-]{3,40}$/.test(key))
    throw new AppError(
      "VALIDATION_FAILED",
      "Kunci kebijakan hanya huruf kecil, angka, dan strip (3-40).",
      { status: 422 },
    );
  if (input.title.trim().length < 3)
    throw new AppError("VALIDATION_FAILED", "Judul kebijakan minimal 3 karakter.", { status: 422 });
  if (input.body.trim().length < 40)
    throw new AppError("VALIDATION_FAILED", "Isi kebijakan terlalu pendek (minimal 40 karakter).", {
      status: 422,
    });
  const db = await getDb();
  const version = await db.transaction(async (tx) => {
    const maxRes = await tx.query<{ v: unknown }>(
      `SELECT COALESCE(max(version),0)::int AS v FROM policies WHERE key = $1`,
      [key],
    );
    const next = num(maxRes.rows[0]?.v) + 1;
    await tx.query(`UPDATE policies SET is_current = false WHERE key = $1`, [key]);
    await tx.query(
      `INSERT INTO policies (key, version, title, body, effective_at, is_current, created_by) VALUES ($1,$2,$3,$4, now(), true, $5)`,
      [key, next, input.title.trim(), input.body.trim(), ctx.user?.id ?? null],
    );
    return next;
  });
  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: "policy.publish",
    targetType: "policy",
    targetId: `${key}-v${version}`,
    afterData: { key, version },
    reason: "Penerbitan versi kebijakan baru dari layar administrasi.",
    requestId: ctx.requestId,
  });
  return {
    version,
    message: `Kebijakan '${key}' versi ${version} terbit. Pesanan baru memakai versi ini; pesanan lama tetap memakai versinya.`,
  };
}

// ---------------------------------------------------------------------
// Permintaan privasi (admin)
// ---------------------------------------------------------------------

export async function listPrivacyRequests(ctx: RequestContext, filters: { status?: string } = {}) {
  requirePermission(ctx, "customer.manage");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT p.id, p.reference, p.email, p.kind, p.status, p.detail, p.created_at, p.completed_at, u.full_name
       FROM privacy_requests p LEFT JOIN users u ON u.id = p.user_id
      WHERE ($1::text IS NULL OR p.status = $1) ORDER BY p.created_at DESC LIMIT 100`,
    [filters.status ?? null],
  );
  return res.rows.map((row) => ({
    id: text(row.id),
    reference: text(row.reference),
    email: text(row.email),
    fullName: optText(row.full_name) ?? "tamu",
    kind: text(row.kind) as PrivacyKind,
    kindLabel: PRIVACY_KIND_LABELS[text(row.kind) as PrivacyKind] ?? text(row.kind),
    status: text(row.status),
    detail: optText(row.detail),
    createdAt: date(row.created_at),
    completedAt: date(row.completed_at),
  }));
}

export async function handlePrivacyRequest(
  ctx: RequestContext,
  id: string,
  decision: "in_progress" | "completed" | "rejected",
  note: string,
): Promise<{ message: string }> {
  requirePermission(ctx, "customer.manage");
  if (note.trim().length < 5)
    throw new AppError("VALIDATION_FAILED", "Catatan tindak lanjut wajib diisi.", { status: 422 });
  const db = await getDb();
  const res = await db.query<{ id: string }>(
    `UPDATE privacy_requests SET status=$2, detail = COALESCE($3, '') || E'\n' || COALESCE(detail,''), handled_by=$4,
            identity_verified_at = CASE WHEN $2 <> 'received' THEN now() ELSE identity_verified_at END,
            completed_at = CASE WHEN $2 IN ('completed','rejected') THEN now() ELSE completed_at END, updated_at = now()
      WHERE id = $1 RETURNING id`,
    [id, decision, note.trim(), ctx.user?.id ?? null],
  );
  if (!res.rows[0]) throw new AppError("NOT_FOUND", "Permintaan tidak ditemukan.", { status: 404 });
  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: `privacy.${decision}`,
    targetType: "privacy_request",
    targetId: id,
    reason: note.trim(),
    requestId: ctx.requestId,
  });
  return {
    message:
      decision === "completed"
        ? "Permintaan ditandai selesai; pelanggan menerima notifikasi ringkasan."
        : "Tindak lanjut dicatat.",
  };
}
