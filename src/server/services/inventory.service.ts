import "server-only";
import { AppError } from "@/domain/errors";
import {
  availableToSell,
  reservationTtlMinutes,
  validateAdjustment,
  type AdjustmentReason,
  type BalanceLike,
} from "@/domain/inventory";
import { bool, date, getDb, num, optNum, optText, text } from "@/platform/db";
import { env } from "@/platform/env";
import { writeAudit } from "@/platform/audit";
import { requirePermission } from "@/server/context";
import type { RequestContext } from "@/server/context";

/**
 * Inventory service (Blueprint §7.1). Saldo tidak pernah "ditimpa" dari UI:
 * selalu delta + reason code + actor + referensi, dicatat di ledger, dan guard stok atomik.
 */

export interface VariantStock {
  variantId: string;
  sku: string;
  locationCode: string;
  balance: BalanceLike;
  available: number;
  lowStockThreshold: number;
  trackInventory: boolean;
}

export async function loadStockForVariants(
  variantIds: readonly string[],
): Promise<Map<string, VariantStock>> {
  const map = new Map<string, VariantStock>();
  if (variantIds.length === 0) return map;
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT v.id AS variant_id, v.sku, v.track_inventory, v.low_stock_threshold,
            COALESCE(ib.location_code,'') AS location_code,
            COALESCE(ib.on_hand,0)::int AS on_hand, COALESCE(ib.reserved,0)::int AS reserved,
            COALESCE(ib.damaged,0)::int AS damaged, COALESCE(ib.safety_stock,0)::int AS safety_stock
       FROM product_variants v
       LEFT JOIN inventory_balances ib ON ib.sku = v.sku
      WHERE v.id = ANY($1::uuid[])`,
    [[...variantIds]],
  );
  for (const row of res.rows) {
    const balance: BalanceLike = {
      onHand: num(row.on_hand),
      reserved: num(row.reserved),
      damaged: num(row.damaged),
      safetyStock: num(row.safety_stock),
    };
    map.set(text(row.variant_id), {
      variantId: text(row.variant_id),
      sku: text(row.sku),
      locationCode: text(row.location_code, env.defaultLocationCode),
      balance,
      available: availableToSell(balance),
      lowStockThreshold: num(row.low_stock_threshold),
      trackInventory: bool(row.track_inventory),
    });
  }
  return map;
}

/** Default guard stok untuk satu varian: dipakai cart/checkout (P0: validasi kuantitas vs stok). */
export async function assertPurchasable(
  variantId: string,
  quantity: number,
): Promise<{ available: number }> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT v.id, v.sku, v.track_inventory, v.min_qty_per_order, v.max_qty_per_order,
            COALESCE(ib.available, 0)::int AS available
       FROM product_variants v LEFT JOIN inventory_balances ib ON ib.sku = v.sku
      WHERE v.id = $1 AND v.is_deleted = false AND v.is_active = true`,
    [variantId],
  );
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Varian produk tidak tersedia.", { status: 404 });
  if (!bool(row.track_inventory)) return { available: Number.POSITIVE_INFINITY };
  const available = num(row.available);
  const min = num(row.min_qty_per_order, 1);
  const max = optNum(row.max_qty_per_order);
  if (quantity < min)
    throw new AppError("VALIDATION_FAILED", `Minimal pembelian ${min} untuk produk ini.`, {
      status: 422,
    });
  if (max !== null && quantity > max)
    throw new AppError("VALIDATION_FAILED", `Maksimal ${max} per pesanan untuk produk ini.`, {
      status: 422,
    });
  if (available < quantity) {
    throw new AppError("STOCK_INSUFFICIENT", "Jumlah yang diminta tidak tersedia.", {
      status: 409,
      details: { availableQuantity: available, requested: quantity },
    });
  }
  return { available };
}

export interface AdjustmentInput {
  sku: string;
  locationCode: string;
  delta: number;
  reason: AdjustmentReason;
  note?: string;
}

/**
 * Adjustment stok. Bila |delta| >= ambang (stock_approval_threshold), dibuat sebagai PERMOHONAN
 * yang menunggu penyetuju berbeda (maker-checker). Ambang dari site_settings/env, bukan hardcode.
 */
export async function adjustStock(
  input: AdjustmentInput,
  ctx: RequestContext,
): Promise<{ applied: boolean; requestId: string | null; message: string }> {
  requirePermission(ctx, "inventory.adjust");
  const db = await getDb();
  const threshold = await stockApprovalThreshold();
  const balanceRes = await db.query<Record<string, unknown>>(
    `SELECT COALESCE(on_hand,0)::int AS on_hand, COALESCE(reserved,0)::int AS reserved,
            COALESCE(damaged,0)::int AS damaged, COALESCE(safety_stock,0)::int AS safety_stock
       FROM inventory_balances WHERE location_code = $1 AND sku = $2`,
    [input.locationCode, input.sku],
  );
  const row = balanceRes.rows[0];
  const current: BalanceLike = row
    ? {
        onHand: num(row.on_hand),
        reserved: num(row.reserved),
        damaged: num(row.damaged),
        safetyStock: num(row.safety_stock),
      }
    : { onHand: 0, reserved: 0, damaged: 0, safetyStock: 0 };

  const validation = validateAdjustment({ ...input }, current);
  if (!validation.ok)
    throw new AppError("VALIDATION_FAILED", validation.message ?? "Penyesuaian stok tidak valid.", {
      status: 422,
    });

  const needsApproval = Math.abs(input.delta) >= threshold;
  if (needsApproval) {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO stock_adjustment_requests (location_code, sku, delta, reason_code, note, requires_approval, requested_by, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7) RETURNING id`,
      [
        input.locationCode,
        input.sku,
        input.delta,
        input.reason,
        input.note ?? null,
        ctx.user?.id ?? null,
        ctx.requestId,
      ],
    );
    await writeAudit({
      actorId: ctx.user?.id,
      actorEmail: ctx.user?.email,
      actorKind: "staff",
      action: "inventory.adjustment.request",
      targetType: "stock_adjustment",
      targetId: String(inserted.rows[0]?.id),
      afterData: { sku: input.sku, delta: input.delta, reason: input.reason },
      reason: `Melebihi ambang otomatis (${threshold}); menunggu persetujuan penyetuju berbeda.`,
      requestId: ctx.requestId,
    });
    return {
      applied: false,
      requestId: String(inserted.rows[0]?.id),
      message: `Perubahan ${input.delta} unit melebihi ambang ${threshold} sehingga diajukan untuk persetujuan.`,
    };
  }

  await applyAdjustment(input, ctx, "direct");
  return {
    applied: true,
    requestId: null,
    message: `Stok ${input.sku} diperbarui (${input.delta > 0 ? "+" : ""}${input.delta}).`,
  };
}

export async function applyAdjustment(
  input: AdjustmentInput,
  ctx: RequestContext,
  source: "direct" | "approval",
  movementKind?: "correction" | "damage" | "undamage" | "return_to_stock" | "receipt",
): Promise<void> {
  const db = await getDb();
  const kind =
    movementKind ??
    (input.reason === "damaged_found"
      ? "damage"
      : input.reason === "damaged_repaired"
        ? "undamage"
        : input.reason.startsWith("customer_return")
          ? "return_to_stock"
          : "correction");
  await db.transaction(async (tx) => {
    // Pastikan baris saldo ada (upsert) lalu ubah atomik dengan guard non-negatif.
    await tx.query(
      `INSERT INTO inventory_balances (location_code, sku, on_hand) VALUES ($1,$2,0)
       ON CONFLICT (location_code, sku) DO NOTHING`,
      [input.locationCode, input.sku],
    );
    const before = await tx.query<Record<string, unknown>>(
      `SELECT on_hand::int AS on_hand, damaged::int AS damaged FROM inventory_balances WHERE location_code=$1 AND sku=$2 FOR UPDATE`,
      [input.locationCode, input.sku],
    );
    const beforeOnHand = num(before.rows[0]?.on_hand);
    const beforeDamaged = num(before.rows[0]?.damaged);
    if (kind === "damage") {
      const qty = Math.abs(input.delta);
      const res = await tx.query(
        `UPDATE inventory_balances SET on_hand = on_hand - $3, damaged = damaged + $3 WHERE location_code=$1 AND sku=$2 AND on_hand >= $3 RETURNING on_hand`,
        [input.locationCode, input.sku, qty],
      );
      if (res.rows.length === 0)
        throw new AppError("STOCK_INSUFFICIENT", "Tidak cukup stok untuk ditandai rusak.", {
          status: 409,
        });
    } else if (kind === "undamage") {
      const qty = Math.abs(input.delta);
      const res = await tx.query(
        `UPDATE inventory_balances SET damaged = damaged - $3, on_hand = on_hand + $3 WHERE location_code=$1 AND sku=$2 AND damaged >= $3 RETURNING on_hand`,
        [input.locationCode, input.sku, qty],
      );
      if (res.rows.length === 0)
        throw new AppError("CONFLICT", "Kuota barang rusak tidak cukup.", { status: 409 });
    } else {
      const res = await tx.query(
        `UPDATE inventory_balances SET on_hand = GREATEST(on_hand + $3, 0) WHERE location_code=$1 AND sku=$2 RETURNING on_hand`,
        [input.locationCode, input.sku, input.delta],
      );
      if (res.rows.length === 0)
        throw new AppError(
          "NOT_FOUND",
          `Saldo stok ${input.sku} tidak ditemukan di lokasi ${input.locationCode}.`,
          { status: 404 },
        );
    }
    const after = await tx.query<{ on_hand: unknown }>(
      `SELECT on_hand::int AS on_hand FROM inventory_balances WHERE location_code=$1 AND sku=$2`,
      [input.locationCode, input.sku],
    );
    const afterOnHand = num(after.rows[0]?.on_hand);

    await tx.query(
      `INSERT INTO inventory_movements (location_code, sku, kind, quantity, balance_before, balance_after, reason_code, note, ref_type, ref_id, actor_id, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'adjustment',$9,$10,$11)`,
      [
        input.locationCode,
        input.sku,
        kind,
        input.delta,
        beforeOnHand,
        afterOnHand,
        input.reason,
        source === "approval" ? "Diterapkan setelah persetujuan" : (input.note ?? null),
        null,
        ctx.user?.id ?? null,
        ctx.requestId,
      ],
    );
    void beforeDamaged;
  });

  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    actorKind: "staff",
    action: "inventory.adjust",
    targetType: "sku",
    targetId: input.sku,
    afterData: { delta: input.delta, reason: input.reason, location: input.locationCode, source },
    reason: input.note ?? undefined,
    requestId: ctx.requestId,
  });
}

export async function decideStockAdjustment(
  requestId: string,
  decision: "approved" | "rejected",
  note: string,
  ctx: RequestContext,
): Promise<void> {
  requirePermission(ctx, "inventory.approve");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM stock_adjustment_requests WHERE id = $1 FOR UPDATE`,
    [requestId],
  );
  const row = res.rows[0];
  if (!row)
    throw new AppError("NOT_FOUND", "Permohonan adjustment tidak ditemukan.", { status: 404 });
  if (text(row.status) !== "pending")
    throw new AppError("CONFLICT", "Permohonan sudah diproses sebelumnya.", { status: 409 });
  if (ctx.user && optText(row.requested_by) === ctx.user.id) {
    throw new AppError(
      "APPROVAL_REQUIRED",
      "Penyetuju harus berbeda dari pengaju (maker-checker).",
      { status: 422 },
    );
  }
  await db.query(
    "UPDATE stock_adjustment_requests SET status=$2, reviewed_by=$3, reviewed_at=now(), review_note=$4 WHERE id=$1",
    [requestId, decision, ctx.user?.id ?? null, note],
  );
  if (decision === "approved") {
    await applyAdjustment(
      {
        sku: text(row.sku),
        locationCode: text(row.location_code),
        delta: num(row.delta),
        reason: text(row.reason_code, "wrong_entry_fix") as AdjustmentReason,
        note: optText(row.note) ?? undefined,
      },
      ctx,
      "approval",
    );
    await db.query(
      "UPDATE stock_adjustment_requests SET status='applied', applied_at=now() WHERE id=$1",
      [requestId],
    );
  }
  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: `inventory.adjustment.${decision}`,
    targetType: "stock_adjustment",
    targetId: requestId,
    reason: note,
    requestId: ctx.requestId,
  });
}

export async function listPendingStockAdjustments(limit = 25) {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT s.*, u.full_name AS requester, v.label AS variant_label, p.name AS product_name
       FROM stock_adjustment_requests s
       LEFT JOIN users u ON u.id = s.requested_by
       JOIN product_variants v ON v.sku = s.sku
       JOIN products p ON p.id = v.product_id
      WHERE s.status = 'pending' ORDER BY s.requested_at DESC LIMIT $1`,
    [limit],
  );
  return res.rows.map((row) => ({
    id: text(row.id),
    sku: text(row.sku),
    productName: text(row.product_name),
    variantLabel: text(row.variant_label),
    locationCode: text(row.location_code),
    delta: num(row.delta),
    reasonCode: text(row.reason_code),
    note: optText(row.note),
    requester: optText(row.requester),
    requestedAt: date(row.requested_at) ?? new Date(),
  }));
}

export async function stockApprovalThreshold(): Promise<number> {
  const db = await getDb();
  const res = await db.query<{ value: unknown }>(
    `SELECT value FROM site_settings WHERE key = 'stock_adjustment_approval_threshold'`,
  );
  const fromDb = num(
    res.rows[0]?.value
      ? typeof res.rows[0]?.value === "object"
        ? (res.rows[0]?.value as { amount?: number }).amount
        : res.rows[0]?.value
      : 0,
  );
  if (fromDb > 0) return fromDb;
  return 50;
}

export interface InventoryRow {
  sku: string;
  variantId: string;
  productName: string;
  variantLabel: string;
  locationCode: string;
  onHand: number;
  reserved: number;
  available: number;
  damaged: number;
  safetyStock: number;
  lowStockThreshold: number;
  status: "out_of_stock" | "low_stock" | "in_stock";
  updatedAt: Date | null;
}

export async function listInventoryBalances(params: {
  q?: string;
  lowOnly?: boolean;
  page?: number;
  perPage?: number;
}): Promise<{ rows: InventoryRow[]; total: number; page: number; perPage: number }> {
  const db = await getDb();
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(10, params.perPage ?? 25));
  const where: string[] = ["v.is_deleted = false"];
  const sqlParams: unknown[] = [];
  if (params.q) {
    sqlParams.push(`%${params.q.toLowerCase()}%`);
    where.push(
      `(lower(v.sku) LIKE $${sqlParams.length} OR lower(p.name) LIKE $${sqlParams.length})`,
    );
  }
  if (params.lowOnly) where.push(`ib.available <= v.low_stock_threshold`);
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const countRes = await db.query<{ c: unknown }>(
    `SELECT count(*)::int AS c FROM product_variants v JOIN products p ON p.id = v.product_id
      LEFT JOIN inventory_balances ib ON ib.sku = v.sku ${whereSql}`,
    sqlParams,
  );
  const res = await db.query<Record<string, unknown>>(
    `SELECT v.id AS variant_id, v.sku, p.name AS product_name, v.label AS variant_label,
            COALESCE(ib.location_code,'') AS location_code, COALESCE(ib.on_hand,0)::int AS on_hand,
            COALESCE(ib.reserved,0)::int AS reserved, COALESCE(ib.available,0)::int AS available,
            COALESCE(ib.damaged,0)::int AS damaged, COALESCE(ib.safety_stock,0)::int AS safety_stock,
            v.low_stock_threshold, ib.updated_at
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN inventory_balances ib ON ib.sku = v.sku
       ${whereSql}
      ORDER BY ib.available ASC NULLS FIRST, p.name ASC
      LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
    sqlParams,
  );
  return {
    rows: res.rows.map((row) => {
      const available = num(row.available);
      const threshold = num(row.low_stock_threshold);
      return {
        sku: text(row.sku),
        variantId: text(row.variant_id),
        productName: text(row.product_name),
        variantLabel: text(row.variant_label),
        locationCode: text(row.location_code, "MAIN"),
        onHand: num(row.on_hand),
        reserved: num(row.reserved),
        available,
        damaged: num(row.damaged),
        safetyStock: num(row.safety_stock),
        lowStockThreshold: threshold,
        status: available <= 0 ? "out_of_stock" : available <= threshold ? "low_stock" : "in_stock",
        updatedAt: date(row.updated_at),
      };
    }),
    total: num(countRes.rows[0]?.c),
    page,
    perPage,
  };
}

export async function listMovements(params: {
  sku?: string;
  limit?: number;
  before?: number;
}): Promise<
  Array<{
    id: string;
    sku: string;
    kind: string;
    quantity: number;
    reasonCode: string | null;
    note: string | null;
    actor: string | null;
    createdAt: Date | null;
  }>
> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT m.id, m.sku, m.kind, m.quantity, m.reason_code, m.note, m.created_at, u.full_name AS actor
       FROM inventory_movements m LEFT JOIN users u ON u.id = m.actor_id
      WHERE ($1::text IS NULL OR m.sku = $1) AND ($2::bigint IS NULL OR m.id < $2)
      ORDER BY m.id DESC LIMIT $3`,
    [params.sku ?? null, params.before ?? null, Math.min(200, params.limit ?? 50)],
  );
  return res.rows.map((row) => ({
    id: text(row.id),
    sku: text(row.sku),
    kind: text(row.kind),
    quantity: num(row.quantity),
    reasonCode: optText(row.reason_code),
    note: optText(row.note),
    actor: optText(row.actor),
    createdAt: date(row.created_at),
  }));
}

/** Job: lepaskan reservasi yang kedaluwarsa (Blueprint §7.1 "reservation TTL + job expiry"). */
export async function expireReservations(): Promise<{ released: number }> {
  const db = await getDb();
  const res = await db.query<{ n: unknown }>(`SELECT fn_expire_reservations(now()) AS n`);
  return { released: num(res.rows[0]?.n) };
}

export function reservationTtl(): number {
  return reservationTtlMinutes(env.reservationTtlMinutes);
}
