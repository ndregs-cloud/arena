import "server-only";
import { bool, date, getDb, jsonb, num, optNum, optText, text, type Tx } from "@/platform/db";
import type { Promotion, PromotionScope } from "@/domain/pricing";
import { AppError } from "@/domain/errors";
import { evaluatePromotion, type PricingLine } from "@/domain/pricing";
import { requirePermission } from "@/server/context";
import type { RequestContext } from "@/server/context";

/** Promosi & kupon. Semua perhitungan berjalan di server memakai snapshot (Blueprint §9.3). */

function mapPromotion(row: Record<string, unknown>): Promotion {
  return {
    id: text(row.id),
    code: text(row.code),
    label: text(row.label),
    kind: text(row.kind, "percent") as Promotion["kind"],
    value: num(row.value),
    minSpendAmount: num(row.min_spend_amount),
    discountCapAmount: optNum(row.discount_cap_amount),
    scope: jsonb<PromotionScope | null>(row.scope, null),
    startsAt: date(row.starts_at),
    endsAt: date(row.ends_at),
    usageLimit: optNum(row.usage_limit),
    usedCount: num(row.used_count),
    perCustomerLimit: optNum(row.per_customer_limit),
    redemptionsByCustomer: num(row.redemptions_by_customer),
    isActive: bool(row.is_active),
    stackable: bool(row.stackable),
  };
}

const PROMOTION_SQL = (alias = "pr") => `
  SELECT ${alias}.*, COALESCE((
           SELECT count(*)::int FROM coupon_redemptions cr
            WHERE cr.promotion_id = ${alias}.id AND ($1::uuid IS NULL OR cr.customer_id = $1)
         ), 0) AS redemptions_by_customer
    FROM promotions ${alias}`;

export async function findPromotionByCode(
  code: string,
  customerId: string | null,
): Promise<Promotion | null> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `${PROMOTION_SQL()} WHERE lower(pr.code) = lower($2) LIMIT 1`,
    [customerId, code.trim()],
  );
  const row = res.rows[0];
  return row ? mapPromotion(row) : null;
}

export async function findPromotionById(
  id: string,
  customerId: string | null,
): Promise<Promotion | null> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `${PROMOTION_SQL()} WHERE pr.id = $2 LIMIT 1`,
    [customerId, id],
  );
  const row = res.rows[0];
  return row ? mapPromotion(row) : null;
}

export async function tryApplyCoupon(
  code: string,
  lines: PricingLine[],
  customerId: string | null,
  at: Date = new Date(),
): Promise<{ promotion: Promotion; evaluation: ReturnType<typeof evaluatePromotion> }> {
  const promotion = await findPromotionByCode(code, customerId);
  if (!promotion) {
    throw new AppError(
      "PROMO_INVALID",
      "Kode tidak dikenali. Periksa kembali ejaan dan syarat promo.",
      { status: 422 },
    );
  }
  const evaluation = evaluatePromotion(promotion, lines, { at });
  if (!evaluation.eligible) {
    throw new AppError(
      evaluation.reasonCode === "OUT_OF_WINDOW"
        ? "PROMO_EXPIRED"
        : evaluation.reasonCode === "USAGE_LIMIT" || evaluation.reasonCode === "PER_CUSTOMER_LIMIT"
          ? "PROMO_LIMIT_REACHED"
          : "PROMO_INVALID",
      evaluation.message ?? "Kode promo belum dapat dipakai.",
      { status: 422, details: { reason: evaluation.reasonCode } },
    );
  }
  return { promotion, evaluation };
}

/** Redemsi kupon bersifat atomik + idempoten per order (Blueprint §9.3 "reserve/redeem atomik"). */
export async function redeemPromotion(input: {
  promotionId: string;
  orderId: string;
  customerId: string | null;
  amount: number;
  alreadyRedeemed: boolean;
}): Promise<void> {
  if (input.alreadyRedeemed) return;
  const db = await getDb();
  await db.query(
    `INSERT INTO coupon_redemptions (promotion_id, order_id, customer_id, amount, created_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (promotion_id, order_id) DO NOTHING`,
    [input.promotionId, input.orderId, input.customerId, input.amount],
  );
  await db.query(
    `UPDATE promotions SET used_count = used_count + 1, updated_at = now() WHERE id = $1 AND (usage_limit IS NULL OR used_count < usage_limit)`,
    [input.promotionId],
  );
}

export async function releasePromotion(orderId: string, executor?: Tx): Promise<void> {
  const db = executor ?? (await getDb());
  const res = await db.query<{ promotion_id: string }>(
    `SELECT promotion_id FROM coupon_redemptions WHERE order_id = $1`,
    [orderId],
  );
  const promotionId = res.rows[0]?.promotion_id;
  if (!promotionId) return;
  await db.query("DELETE FROM coupon_redemptions WHERE order_id = $1", [orderId]);
  await db.query(
    "UPDATE promotions SET used_count = GREATEST(used_count - 1, 0), updated_at = now() WHERE id = $1",
    [promotionId],
  );
}

export interface AdminPromotionRow {
  id: string;
  code: string;
  label: string;
  kind: Promotion["kind"];
  value: number;
  minSpendAmount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  usageLimit: number | null;
  usedCount: number;
  state: "scheduled" | "active" | "expired" | "paused";
}

export async function adminListPromotions(ctx: RequestContext): Promise<AdminPromotionRow[]> {
  requirePermission(ctx, "promotion.manage");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM promotions ORDER BY starts_at DESC LIMIT 100`,
  );
  const now = Date.now();
  return res.rows.map((row) => {
    const startsAt = date(row.starts_at);
    const endsAt = date(row.ends_at);
    const isActive = bool(row.is_active);
    const state: AdminPromotionRow["state"] = !isActive
      ? "paused"
      : startsAt && startsAt.getTime() > now
        ? "scheduled"
        : endsAt && endsAt.getTime() < now
          ? "expired"
          : "active";
    return {
      id: text(row.id),
      code: text(row.code),
      label: text(row.label),
      kind: text(row.kind, "percent") as Promotion["kind"],
      value: num(row.value),
      minSpendAmount: num(row.min_spend_amount),
      startsAt,
      endsAt,
      isActive,
      usageLimit: optNum(row.usage_limit),
      usedCount: num(row.used_count),
      state,
    };
  });
}

export async function adminUpsertPromotion(
  input: {
    id?: string;
    code: string;
    label: string;
    kind: Promotion["kind"];
    value: number;
    minSpendAmount: number;
    discountCapAmount?: number | null;
    startsAt: string;
    endsAt: string;
    usageLimit?: number | null;
    perCustomerLimit?: number | null;
    stackable: boolean;
    isActive: boolean;
    scope?: PromotionScope | null;
  },
  ctx: RequestContext,
): Promise<void> {
  requirePermission(ctx, "promotion.manage");
  const db = await getDb();
  const params = [
    input.code.toUpperCase(),
    input.label,
    input.kind,
    input.value,
    input.minSpendAmount,
    input.discountCapAmount ?? null,
    input.scope ? JSON.stringify(input.scope) : null,
    new Date(input.startsAt).toISOString(),
    new Date(input.endsAt).toISOString(),
    input.usageLimit ?? null,
    input.perCustomerLimit ?? null,
    input.stackable,
    input.isActive,
  ];
  if (input.id) {
    await db.query(
      `UPDATE promotions SET code=$1, label=$2, kind=$3, value=$4, min_spend_amount=$5, discount_cap_amount=$6, scope=$7::jsonb,
              starts_at=$8, ends_at=$9, usage_limit=$10, per_customer_limit=$11, stackable=$12, is_active=$13 WHERE id=$14`,
      [...params, input.id],
    );
  } else {
    await db.query(
      `INSERT INTO promotions (code,label,kind,value,min_spend_amount,discount_cap_amount,scope,starts_at,ends_at,usage_limit,per_customer_limit,stackable,is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13)`,
      params,
    );
  }
  await db.query(
    `INSERT INTO audit_logs (actor_id, actor_email, actor_kind, action, target_type, target_id, after_data, request_id)
     VALUES ($1,$2,'staff','promotion.upsert','promotion',$3,$4::jsonb,$5)`,
    [
      ctx.user?.id ?? null,
      ctx.user?.email ?? null,
      input.id ?? null,
      JSON.stringify({
        code: input.code,
        kind: input.kind,
        value: input.value,
        isActive: input.isActive,
      }),
      ctx.requestId,
    ],
  );
}

export async function adminSetPromotionActive(
  id: string,
  isActive: boolean,
  ctx: RequestContext,
): Promise<void> {
  requirePermission(ctx, "promotion.manage");
  const db = await getDb();
  await db.query("UPDATE promotions SET is_active = $2, updated_at = now() WHERE id = $1", [
    id,
    isActive,
  ]);
  await db.query(
    `INSERT INTO audit_logs (actor_id, actor_email, actor_kind, action, target_type, target_id, after_data, request_id)
     VALUES ($1,$2,'staff',$3,'promotion',$4,$5::jsonb,$6)`,
    [
      ctx.user?.id ?? null,
      ctx.user?.email ?? null,
      isActive ? "promotion.activate" : "promotion.pause",
      id,
      JSON.stringify({ isActive }),
      ctx.requestId,
    ],
  );
}

export async function promotionUsage(
  promotionId: string,
): Promise<Array<{ orderNumber: string; amount: number; createdAt: Date | null }>> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT o.order_number, cr.amount, cr.created_at FROM coupon_redemptions cr
      JOIN orders o ON o.id = cr.order_id WHERE cr.promotion_id = $1 ORDER BY cr.created_at DESC LIMIT 25`,
    [promotionId],
  );
  return res.rows.map((row) => ({
    orderNumber: text(row.order_number),
    amount: num(row.amount),
    createdAt: date(row.created_at),
  }));
}
