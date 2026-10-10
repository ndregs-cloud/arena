import "server-only";
import { AppError } from "@/domain/errors";
import {
  assertReturnTransition,
  computeReturnRefund,
  evaluateReturnEligibility,
  reasonRequiresPhoto,
  RETURN_REASONS,
  shouldRestockOnResolution,
  shouldRefundShipping,
  type ReturnResolution,
  type ReturnStatus,
} from "@/domain/returns";
import { writeAudit } from "@/platform/audit";
import { generateReference } from "@/domain/ids";
import { date, getDb, num, optNum, optText, text } from "@/platform/db";
import { env } from "@/platform/env";
import { enqueueNotification } from "@/platform/notifications";
import { formatIDR } from "@/lib/format";
import { requirePermission, requireUser } from "@/server/context";
import type { RequestContext } from "@/server/context";
import { loadOrderSnapshot } from "@/server/services/checkout.service";
import { transitionOrder } from "@/server/services/order.service";
import { requestRefund, settleRefund, submitRefund } from "@/server/services/payment.service";

/**
 * Retur & refund (Blueprint §7.3). Status retur DIPISAH dari status refund, dan
 * refund hanya diberi label selesai setelah konfirmasi provider/ledger (desain §11.3).
 */

export interface ReturnDetailRow {
  id: string;
  reference: string;
  orderId: string;
  orderNumber: string;
  status: ReturnStatus;
  reasonCode: string;
  reasonLabel: string;
  description: string;
  resolution: ReturnResolution;
  requestedAmount: number;
  approvedAmount: number | null;
  refundStatus: string | null;
  refundAmount: number | null;
  policyVersion: string;
  decisionNote: string | null;
  deadlineAt: Date | null;
  createdAt: Date | null;
  closedAt: Date | null;
  customerName: string | null;
  customerEmail: string;
  items: Array<{
    orderItemId: string;
    productName: string;
    variantLabel: string;
    quantityRequested: number;
    quantityReceived: number;
    quantityRestocked: number;
    quantityDamaged: number;
    amount: number;
  }>;
  timeline: Array<{
    id: string;
    type: string;
    note: string | null;
    createdAt: Date | null;
    visibility: string;
  }>;
  eligibleForRestock: boolean;
}

function mapReturnDetail(
  row: Record<string, unknown>,
  items: Record<string, unknown>[],
  timeline: Record<string, unknown>[],
): ReturnDetailRow {
  const reasonCode = text(row.reason_code);
  return {
    id: text(row.id),
    reference: text(row.reference),
    orderId: text(row.order_id),
    orderNumber: text(row.order_number),
    status: text(row.status) as ReturnStatus,
    reasonCode,
    reasonLabel: RETURN_REASONS.find((r) => r.code === reasonCode)?.label ?? reasonCode,
    description: text(row.description),
    resolution: text(row.resolution, "refund") as ReturnResolution,
    requestedAmount: num(row.requested_amount),
    approvedAmount: optNum(row.approved_amount),
    refundStatus: optText(row.refund_status),
    refundAmount: optNum(row.refund_amount),
    policyVersion: text(row.policy_version, "1"),
    decisionNote: optText(row.decision_note),
    deadlineAt: date(row.deadline_at),
    createdAt: date(row.created_at),
    closedAt: date(row.closed_at),
    customerName: optText(row.customer_name),
    customerEmail: text(row.customer_email),
    items: items.map((item) => ({
      orderItemId: text(item.order_item_id),
      productName: text(item.product_name),
      variantLabel: text(item.variant_label),
      quantityRequested: num(item.quantity_requested),
      quantityReceived: num(item.quantity_received),
      quantityRestocked: num(item.quantity_restocked),
      quantityDamaged: num(item.quantity_damaged),
      amount: num(item.amount),
    })),
    timeline: timeline.map((e) => ({
      id: text(e.id),
      type: text(e.event_type),
      note: optText(e.note),
      createdAt: date(e.created_at),
      visibility: text(e.visibility, "customer"),
    })),
    eligibleForRestock: ["item_received", "inspected"].includes(text(row.status)),
  };
}

/**
 * Detail retur untuk pelanggan. Refund dibaca dari ledger (bukan digantung dengan placeholder),
 * supaya status dana yang ditampilkan pelanggan = status sebenarnya.
 */
export async function getReturnForCustomer(
  ctx: RequestContext,
  reference: string,
): Promise<ReturnDetailRow> {
  const user = requireUser(ctx);
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `${RETURN_SELECT} WHERE r.reference = $1 AND (o.customer_id = $2 OR r.customer_id = $2) LIMIT 1`,
    [reference, user.id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Pengajuan retur tidak ditemukan.", { status: 404 });
  return loadReturnDetail(row);
}

/** Daftar retur milik akun yang sedang masuk (halaman akun). */
export async function listCustomerReturns(ctx: RequestContext): Promise<ReturnDetailRow[]> {
  const user = requireUser(ctx);
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `${RETURN_SELECT} WHERE o.customer_id = $1 OR r.customer_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
    [user.id],
  );
  return Promise.all(res.rows.map((row) => loadReturnDetail(row)));
}

const RETURN_SELECT = `SELECT r.*, o.order_number, o.email AS customer_email,
        COALESCE(ref.status, 'none') AS refund_status,
        COALESCE(ref.amount, 0)::int AS refund_amount
     FROM returns r
     JOIN orders o ON o.id = r.order_id
     LEFT JOIN LATERAL (
       SELECT status, amount FROM refunds WHERE return_id = r.id ORDER BY created_at DESC LIMIT 1
     ) ref ON true`;

async function loadReturnDetail(row: Record<string, unknown>): Promise<ReturnDetailRow> {
  const db = await getDb();
  const [items, timeline] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT ri.*, oi.name_snapshot AS product_name, oi.variant_label_snapshot AS variant_label
         FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id WHERE ri.return_id = $1`,
      [text(row.id)],
    ),
    db.query<Record<string, unknown>>(
      `SELECT * FROM return_events WHERE return_id = $1 ORDER BY id ASC`,
      [text(row.id)],
    ),
  ]);
  return mapReturnDetail(row, items.rows, timeline.rows);
}

/** Kelayakan retur untuk form (dihitung ulang di server, tidak dipercaya dari klien). */
export async function checkReturnEligibility(ctx: RequestContext, orderNumber: string) {
  const user = requireUser(ctx);
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM orders WHERE order_number = $1 AND customer_id = $2 LIMIT 1`,
    [orderNumber, user.id],
  );
  const row = res.rows[0];
  if (!row)
    throw new AppError("NOT_FOUND", "Pesanan tidak ditemukan untuk akun Anda.", { status: 404 });
  const snapshot = await loadOrderSnapshot(text(row.id));
  if (!snapshot) throw new AppError("NOT_FOUND", "Pesanan tidak ditemukan.", { status: 404 });

  const returnedRes = await db.query<Record<string, unknown>>(
    `SELECT ri.order_item_id, sum(ri.quantity_requested)::int AS returned_qty
       FROM return_items ri JOIN returns r ON r.id = ri.return_id
      WHERE r.order_id = $1 AND r.status NOT IN ('cancelled','rejected')
      GROUP BY ri.order_item_id`,
    [snapshot.id],
  );
  const already: Record<string, number> = {};
  for (const r of returnedRes.rows) already[text(r.order_item_id)] = num(r.returned_qty);

  const eligibility = evaluateReturnEligibility({
    order: snapshot,
    orderItemIds: snapshot.lines.map((l) => l.orderItemId),
    quantities: Object.fromEntries(
      snapshot.lines.map((l) => [l.orderItemId, l.quantity - (already[l.orderItemId] ?? 0)]),
    ),
    alreadyReturnedQuantities: already,
    deliveredAt: snapshot.deliveredAt,
    returnWindowDays: env.returnWindowDays,
    at: new Date(),
  });

  return {
    order: snapshot,
    eligibility,
    returnWindowDays: env.returnWindowDays,
    reasons: RETURN_REASONS.map((r) => ({
      code: r.code,
      label: r.label,
      requiresPhoto: r.requiresPhoto,
    })),
  };
}

export interface CreateReturnInput {
  orderNumber: string;
  reasonCode: string;
  description: string;
  resolution: ReturnResolution;
  lines: Array<{ orderItemId: string; quantity: number; note?: string }>;
  photoRefs?: string[];
}

export async function createReturnRequest(
  ctx: RequestContext,
  input: CreateReturnInput,
): Promise<{ reference: string; message: string }> {
  const user = requireUser(ctx);
  const db = await getDb();
  const eligibility = await checkReturnEligibility(ctx, input.orderNumber);
  if (!eligibility.eligibility.eligible) {
    throw new AppError(
      "VALIDATION_FAILED",
      eligibility.eligibility.messages[0] ?? "Retur tidak memenuhi syarat.",
      {
        status: 422,
        details: { lines: eligibility.eligibility.lines },
      },
    );
  }
  if (reasonRequiresPhoto(input.reasonCode) && (!input.photoRefs || input.photoRefs.length === 0)) {
    throw new AppError("VALIDATION_FAILED", "Untuk alasan ini, lampiran foto wajib diisi.", {
      status: 422,
    });
  }
  if (input.photoRefs && input.photoRefs.length > 6) {
    throw new AppError("VALIDATION_FAILED", "Maksimal 6 lampiran.", { status: 422 });
  }

  const order = eligibility.order;
  // Validasi per baris dari sisi server: baris harus milik order ini (mencegah nomor item order
  // lain diselundupkan) dan jumlahnya tidak boleh melebihi sisa yang bisa diretur.
  const remainingByLine = new Map(
    eligibility.eligibility.lines.map((l) => [l.orderItemId, l.returnableQuantity]),
  );
  for (const line of input.lines) {
    const remaining = remainingByLine.get(line.orderItemId);
    if (remaining === undefined) {
      throw new AppError("VALIDATION_FAILED", "Item yang diajukan tidak ada dalam pesanan ini.", {
        status: 422,
      });
    }
    if (line.quantity > remaining) {
      throw new AppError(
        "VALIDATION_FAILED",
        `Jumlah yang masih bisa diretur untuk item ini tinggal ${remaining}.`,
        {
          status: 422,
          details: {
            orderItemId: line.orderItemId,
            returnableQuantity: remaining,
            requested: line.quantity,
          },
        },
      );
    }
  }
  const refund = computeReturnRefund({
    order,
    lines: input.lines.map((l) => ({ orderItemId: l.orderItemId, returnQuantity: l.quantity })),
    includeShipping: shouldRefundShipping(input.reasonCode),
  });

  const reference = generateReference("RET");

  const returnId = await db.transaction(async (tx) => {
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO returns (reference, order_id, customer_id, status, reason_code, description, resolution, policy_version,
                            requested_amount, evidence, deadline_at)
       VALUES ($1,$2,$3,'requested',$4,$5,$6,$7,$8,$9::jsonb, now() + ($10 || ' days')::interval)
       RETURNING id`,
      [
        reference,
        order.id,
        user.id,
        input.reasonCode,
        input.description,
        input.resolution,
        order.policyVersion,
        refund.amount,
        JSON.stringify(
          (input.photoRefs ?? []).map((p) => ({
            ref: p,
            note: "lampiran pelanggan (disimpan di storage; tidak disalin ke DB)",
          })),
        ),
        String(Math.max(1, Math.trunc(env.returnWindowDays))),
      ],
    );
    const id = String(inserted.rows[0]?.id);
    for (const line of input.lines) {
      const snapshotLine = order.lines.find((l) => l.orderItemId === line.orderItemId);
      const allocated = snapshotLine
        ? Math.round(
            (snapshotLine.lineTotalAmount - snapshotLine.discountAllocatedAmount) *
              (line.quantity / Math.max(1, snapshotLine.quantity)),
          )
        : 0;
      await tx.query(
        `INSERT INTO return_items (return_id, order_item_id, quantity_requested, amount) VALUES ($1,$2,$3,$4)`,
        [id, line.orderItemId, line.quantity, allocated],
      );
    }
    await tx.query(
      `INSERT INTO return_events (return_id, event_type, to_status, actor_id, note, visibility)
       VALUES ($1,'requested','requested',$2,$3,'customer')`,
      [
        id,
        user.id,
        `Pengajuan retur dibuat (${input.lines.length} baris, nominal diajukan ${formatIDR(refund.amount)}).`,
      ],
    );
    await tx.query(
      `UPDATE orders SET status='return_requested', updated_at=now() WHERE id=$1 AND status IN ('delivered','completed')`,
      [order.id],
    );
    await tx.query(
      `INSERT INTO order_events (order_id, event_type, from_status, to_status, actor_id, actor_kind, visibility, note, request_id)
       VALUES ($1,'return_requested',$2,'return_requested',$3,'customer','customer',$4,$5)`,
      [order.id, order.status, user.id, `Pelanggan mengajukan retur ${reference}.`, ctx.requestId],
    );
    return id;
  });

  await enqueueNotification({
    kind: "return_requested",
    to: order.email,
    vars: { returnRef: reference, orderNumber: order.orderNumber },
  });
  await writeAudit({
    actorId: user.id,
    actorEmail: user.email,
    actorKind: "customer",
    action: "return.create",
    targetType: "return",
    targetId: returnId,
    afterData: {
      orderNumber: order.orderNumber,
      reasonCode: input.reasonCode,
      amount: refund.amount,
    },
    requestId: ctx.requestId,
  });

  return {
    reference,
    message: `Pengajuan retur ${reference} dibuat. Nominal yang diajukan ${formatIDR(refund.amount)}. Nomor kasus dapat dipakai untuk memantau status.`,
  };
}

export async function adminListReturns(
  ctx: RequestContext,
  filters: { status?: string; page?: number } = {},
): Promise<ReturnDetailRow[]> {
  requirePermission(ctx, "return.manage");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT r.*, o.order_number, o.email AS customer_email, u.full_name AS customer_name,
            ref.status AS refund_status, ref.amount AS refund_amount
       FROM returns r
       JOIN orders o ON o.id = r.order_id
       LEFT JOIN users u ON u.id = r.customer_id
       LEFT JOIN refunds ref ON ref.id = r.refund_id
      WHERE ($1::text IS NULL OR r.status = $1)
      ORDER BY r.created_at DESC LIMIT 50`,
    [filters.status ?? null],
  );
  const out: ReturnDetailRow[] = [];
  for (const row of res.rows) out.push(await loadReturnDetail(row));
  return out;
}

export async function adminGetReturn(ctx: RequestContext, id: string): Promise<ReturnDetailRow> {
  requirePermission(ctx, "return.manage");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT r.*, o.order_number, o.email AS customer_email, u.full_name AS customer_name, ref.status AS refund_status, ref.amount AS refund_amount
       FROM returns r JOIN orders o ON o.id = r.order_id
       LEFT JOIN users u ON u.id = r.customer_id
       LEFT JOIN refunds ref ON ref.id = r.refund_id WHERE r.id = $1`,
    [id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Retur tidak ditemukan.", { status: 404 });
  return loadReturnDetail(row);
}

/** Keputusan CS: approve (buat otorisasi retur + instruksi kirim balik) atau reject dengan alasan. */
export async function decideReturn(
  ctx: RequestContext,
  id: string,
  decision: "approved" | "rejected",
  note: string,
  approvedAmount?: number,
): Promise<{ message: string }> {
  requirePermission(ctx, "return.approve");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM returns WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Retur tidak ditemukan.", { status: 404 });
  const status = text(row.status) as ReturnStatus;
  assertReturnTransition(status, decision === "approved" ? "approved" : "rejected");
  const order = await loadOrderSnapshot(text(row.order_id));
  if (!order) throw new AppError("NOT_FOUND", "Order terkait tidak ditemukan.", { status: 404 });

  const amount =
    decision === "approved"
      ? Math.min(
          approvedAmount ?? num(row.requested_amount),
          order.totalAmount - order.refundedAmount,
        )
      : 0;

  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE returns SET status=$2, decision_note=$3, decided_by=$4, decided_at=now(), approved_amount=$5,
              deadline_at = CASE WHEN $2 = 'approved' THEN now() + interval '10 days' ELSE deadline_at END
        WHERE id=$1`,
      [
        id,
        decision === "approved" ? "awaiting_return" : "rejected",
        note,
        ctx.user?.id ?? null,
        amount,
      ],
    );
    await tx.query(
      `INSERT INTO return_events (return_id, event_type, from_status, to_status, actor_id, note, visibility)
       VALUES ($1,$2,$3,$4,$5,$6,'customer')`,
      [
        id,
        decision,
        status,
        decision === "approved" ? "awaiting_return" : "rejected",
        ctx.user?.id ?? null,
        note,
      ],
    );
    if (decision === "rejected") {
      await tx.query(
        `UPDATE orders SET status='completed', updated_at=now() WHERE id=$1 AND status='return_requested'`,
        [order.id],
      );
    }
  });

  await enqueueNotification({
    kind: "return_decision",
    to: order.email,
    returnId: id,
    vars: {
      returnRef: text(row.reference),
      orderNumber: order.orderNumber,
      decision: decision === "approved" ? "disetujui" : "ditolak",
      decisionNote:
        decision === "approved"
          ? `Kirim barang ke alamat gudang kami dalam 10 hari. Sertakan nomor retur. Setelah diterima dan diperiksa, ${formatIDR(amount)} akan diproses sesuai metode penyelesaian.`
          : note,
    },
  });
  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: `return.${decision}`,
    targetType: "return",
    targetId: id,
    afterData: { approvedAmount: amount, note },
    reason: note,
    requestId: ctx.requestId,
  });
  return {
    message:
      decision === "approved"
        ? `Retur disetujui. Nilai yang dapat diretur: ${formatIDR(amount)}. Tenggat kirim balik 10 hari.`
        : "Retur ditolak; alasan dikirim ke pelanggan.",
  };
}

export async function receiveReturnItems(
  ctx: RequestContext,
  id: string,
  received: Array<{ orderItemId: string; quantity: number; damaged?: boolean }>,
): Promise<{ message: string }> {
  requirePermission(ctx, "return.manage");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(`SELECT * FROM returns WHERE id=$1`, [id]);
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Retur tidak ditemukan.", { status: 404 });
  assertReturnTransition(text(row.status) as ReturnStatus, "item_received");

  await db.transaction(async (tx) => {
    for (const item of received) {
      await tx.query(
        `UPDATE return_items SET quantity_received = quantity_received + $3
          WHERE return_id = $1 AND order_item_id = $2 AND quantity_received + $3 <= quantity_requested`,
        [id, item.orderItemId, item.quantity],
      );
    }
    await tx.query("UPDATE returns SET status='item_received', updated_at=now() WHERE id=$1", [id]);
    await tx.query(
      `INSERT INTO return_events (return_id, event_type, from_status, to_status, actor_id, note, visibility)
       VALUES ($1,'item_received',$2,'item_received',$3,$4,'customer')`,
      [
        id,
        text(row.status),
        ctx.user?.id ?? null,
        `Barang diterima: ${received.map((r) => `${r.orderItemId.slice(0, 8)}×${r.quantity}`).join(", ")}`,
      ],
    );
  });
  return { message: "Barang retur dicatat diterima. Lakukan pemeriksaan sebelum restock/refund." };
}

/**
 * Inspeksi + restock. Barang yang rusak TIDAK masuk stok jual (Blueprint §7.3).
 */
export async function inspectReturn(
  ctx: RequestContext,
  id: string,
  input: { passed: boolean; note: string; damagedQty?: Record<string, number> },
): Promise<{ message: string; restocked: number }> {
  requirePermission(ctx, "return.manage");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(`SELECT * FROM returns WHERE id=$1`, [id]);
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Retur tidak ditemukan.", { status: 404 });
  assertReturnTransition(text(row.status) as ReturnStatus, "inspected");

  const itemsRes = await db.query<Record<string, unknown>>(
    `SELECT ri.*, v.sku AS variant_sku FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id JOIN product_variants v ON v.id = oi.variant_id WHERE ri.return_id = $1`,
    [id],
  );
  let restocked = 0;
  await db.transaction(async (tx) => {
    for (const item of itemsRes.rows) {
      const requested = num(item.quantity_requested);
      const damaged = Math.max(0, Math.trunc(input.damagedQty?.[text(item.order_item_id)] ?? 0));
      const good = Math.max(0, requested - damaged);
      const willRestock = shouldRestockOnResolution(
        text(item.resolution, "refund") as ReturnResolution,
        input.passed,
        damaged > 0,
      );
      await tx.query(
        `UPDATE return_items SET quantity_restocked = CASE WHEN $2 THEN $3 ELSE 0 END, quantity_damaged = $4 WHERE return_id=$1 AND order_item_id=$5`,
        [id, willRestock, good, damaged, text(item.order_item_id)],
      );
      if (willRestock && good > 0) {
        await tx.query(
          `INSERT INTO inventory_movements (location_code, sku, kind, quantity, balance_before, balance_after, reason_code, ref_type, ref_id, actor_id, request_id)
           SELECT $1,$2,'return_to_stock',$3::integer, b.on_hand, b.on_hand + $3::integer, 'customer_return_resellable', 'return', $4, $5, $6
             FROM inventory_balances b WHERE b.sku=$2 AND b.location_code=$1`,
          [
            env.defaultLocationCode,
            text(item.variant_sku),
            good,
            id,
            ctx.user?.id ?? null,
            ctx.requestId,
          ],
        );
        await tx.query(
          `UPDATE inventory_balances SET on_hand = on_hand + $3, updated_at = now() WHERE location_code = $1 AND sku = $2`,
          [env.defaultLocationCode, text(item.variant_sku), good],
        );
        restocked += good;
      }
      if (damaged > 0) {
        await tx.query(
          `INSERT INTO inventory_movements (location_code, sku, kind, quantity, balance_before, balance_after, reason_code, ref_type, ref_id, actor_id, request_id)
           SELECT $1,$2,'damage',$3::integer, b.on_hand, b.on_hand - $3::integer, 'damaged_found', 'return', $4, $5, $6
             FROM inventory_balances b WHERE b.sku=$2 AND b.location_code=$1`,
          [
            env.defaultLocationCode,
            text(item.variant_sku),
            damaged,
            id,
            ctx.user?.id ?? null,
            ctx.requestId,
          ],
        );
        await tx.query(
          "UPDATE inventory_balances SET on_hand = GREATEST(on_hand - $3, 0), damaged = damaged + $3 WHERE location_code=$1 AND sku=$2",
          [env.defaultLocationCode, text(item.variant_sku), damaged],
        );
      }
    }
    await tx.query(
      "UPDATE returns SET status='inspected', inspection=$2::jsonb, restock_allowed=$3, updated_at=now() WHERE id=$1",
      [
        id,
        JSON.stringify({
          passed: input.passed,
          note: input.note,
          inspectedAt: new Date().toISOString(),
          inspector: ctx.user?.email ?? null,
        }),
        input.passed,
      ],
    );
    await tx.query(
      `INSERT INTO return_events (return_id, event_type, from_status, to_status, actor_id, note, visibility)
       VALUES ($1,'inspected',$2,'inspected',$3,$4,'internal')`,
      [
        id,
        text(row.status),
        ctx.user?.id ?? null,
        `${input.passed ? "Lolos" : "Tidak lolos"} pemeriksaan. ${input.note}`,
      ],
    );
  });

  await writeAudit({
    actorId: ctx.user?.id,
    actorEmail: ctx.user?.email,
    action: "return.inspect",
    targetType: "return",
    targetId: id,
    afterData: { passed: input.passed, restocked },
    reason: input.note,
    requestId: ctx.requestId,
  });
  return {
    message: `Pemeriksaan dicatat. ${restocked} unit dikembalikan ke stok jual.`,
    restocked,
  };
}

/** Penyelesaian: refund (lewat ledger) / exchange / store credit / penolakan akhir. */
export async function resolveReturn(
  ctx: RequestContext,
  id: string,
  input: { resolution: ReturnResolution; note: string },
): Promise<{ message: string }> {
  requirePermission(ctx, "return.manage");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(`SELECT * FROM returns WHERE id=$1`, [id]);
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Retur tidak ditemukan.", { status: 404 });
  assertReturnTransition(text(row.status) as ReturnStatus, "resolved");
  const order = await loadOrderSnapshot(text(row.order_id));
  if (!order) throw new AppError("NOT_FOUND", "Order tidak ditemukan.", { status: 404 });
  const amount = optNum(row.approved_amount) ?? num(row.requested_amount);

  if (input.resolution === "refund") {
    if (order.paymentStatus !== "succeeded" && order.paymentStatus !== "partially_refunded") {
      throw new AppError(
        "PAYMENT_NOT_CONFIRMED",
        "Refund tidak dapat diproses sebelum pembayaran terkonfirmasi.",
        { status: 422 },
      );
    }
    const refundResult = await requestRefund(ctx, {
      orderId: order.id,
      amount,
      reason: `Retur ${text(row.reference)}: ${text(row.reason_code)}`,
      includeShipping: shouldRefundShipping(text(row.reason_code)),
      returnId: id,
      items: [],
    });
    let message = `Refund ${formatIDR(amount)} ${refundResult.awaitingApproval ? "menunggu persetujuan penyetuju" : "disetujui dan siap dikirim ke penyedia"}.`;
    if (!refundResult.awaitingApproval) {
      await submitRefund(ctx, refundResult.refund.id);
      await settleRefund(ctx, refundResult.refund.id, { providerConfirmed: true });
      message = `Refund ${formatIDR(amount)} diproses dan selesai (konfirmasi ${refundResult.refund.providerRefundRef ? "penyedia" : "simulasi"}).`;
    }
    await db.query(
      `UPDATE returns SET resolution='refund', status='resolved', closed_at=now(), updated_at=now() WHERE id=$1`,
      [id],
    );
    await db.query(
      `INSERT INTO return_events (return_id, event_type, from_status, to_status, actor_id, note, visibility)
       VALUES ($1,'resolved',$2,'resolved',$3,$4,'customer')`,
      [id, text(row.status), ctx.user?.id ?? null, message],
    );
    await db.query(`UPDATE orders SET status='returned', updated_at=now() WHERE id=$1`, [order.id]);
    await transitionOrder(ctx, order.id, "refunded", { reason: message }).catch(() => undefined);
    await enqueueNotification({
      kind: "refund_succeeded",
      to: order.email,
      orderId: order.id,
      vars: {
        orderNumber: order.orderNumber,
        amount: formatIDR(amount),
        refundRef: refundResult.refund.reference,
      },
    });
    return { message };
  }

  await db.query(
    `UPDATE returns SET resolution=$2, status='resolved', closed_at=now(), updated_at=now(), decision_note = COALESCE($3, decision_note) WHERE id=$1`,
    [id, input.resolution, input.note],
  );
  await db.query(
    `INSERT INTO return_events (return_id, event_type, from_status, to_status, actor_id, note, visibility)
     VALUES ($1,'resolved',$2,'resolved',$3,$4,'customer')`,
    [
      id,
      text(row.status),
      ctx.user?.id ?? null,
      input.resolution === "exchange"
        ? "Penukaran barang dijadwalkan."
        : "Kredit toko diterbitkan.",
    ],
  );
  return {
    message:
      input.resolution === "exchange"
        ? "Retur diselesaikan dengan penukaran; tim gudang akan memproses barang pengganti."
        : input.resolution === "store_credit"
          ? `Retur diselesaikan dengan kredit toko ${formatIDR(amount)} (to be implemented pada modul loyalty).`
          : "Retur ditutup tanpa pengembalian dana.",
  };
}

export async function restockAdjustmentPreview(ctx: RequestContext, id: string) {
  requirePermission(ctx, "return.manage");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT ri.quantity_requested, ri.quantity_received, v.sku, p.name, v.label
       FROM return_items ri
       JOIN order_items oi ON oi.id = ri.order_item_id
       JOIN product_variants v ON v.id = oi.variant_id
       JOIN products p ON p.id = v.product_id
      WHERE ri.return_id = $1`,
    [id],
  );
  return res.rows.map((row) => ({
    sku: text(row.sku),
    productName: text(row.name),
    variantLabel: text(row.label),
    received: num(row.quantity_received),
    requested: num(row.quantity_requested),
  }));
}
