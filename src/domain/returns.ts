import { AppError } from "@/domain/errors";
import { DAY_MS, addDays } from "@/domain/clock";
import { roundHalfUp } from "@/domain/money";
import { lineRefundable, type OrderSnapshot } from "@/domain/orders";

/** Retur/exchange (Blueprint §7.3). Status retur DIPISAH dari status refund. */

export const RETURN_STATUSES = [
  "requested",
  "approved",
  "rejected",
  "awaiting_return",
  "item_received",
  "inspected",
  "resolved",
  "cancelled",
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const RETURN_RESOLUTIONS = ["refund", "exchange", "store_credit", "none"] as const;
export type ReturnResolution = (typeof RETURN_RESOLUTIONS)[number];

export const RETURN_REASONS = [
  {
    code: "damaged_on_arrival",
    label: "Barang rusak saat tiba",
    requiresPhoto: true,
    refundShippingPolicy: "refund" as const,
  },
  {
    code: "wrong_item",
    label: "Barang tidak sesuai pesanan",
    requiresPhoto: true,
    refundShippingPolicy: "refund" as const,
  },
  {
    code: "not_as_described",
    label: "Tidak sesuai deskripsi",
    requiresPhoto: false,
    refundShippingPolicy: "refund" as const,
  },
  {
    code: "size_unfit",
    label: "Ukuran tidak pas",
    requiresPhoto: false,
    refundShippingPolicy: "no_refund" as const,
  },
  {
    code: "changed_mind",
    label: "Berubah pikiran",
    requiresPhoto: false,
    refundShippingPolicy: "no_refund" as const,
  },
  {
    code: "defective",
    label: "Tidak berfungsi semestinya",
    requiresPhoto: true,
    refundShippingPolicy: "refund" as const,
  },
] as const;
export type ReturnReasonCode = (typeof RETURN_REASONS)[number]["code"];

export function reasonRequiresPhoto(code: string): boolean {
  return RETURN_REASONS.find((r) => r.code === code)?.requiresPhoto === true;
}

export interface ReturnEligibilityInput {
  order: OrderSnapshot;
  orderItemIds: string[];
  /** Jumlah yang diminta pelanggan per baris order. */
  quantities: Record<string, number>;
  /** Jumlah yang sudah pernah diretur per baris (agregasi dari return_items di DB). */
  alreadyReturnedQuantities?: Record<string, number>;
  deliveredAt: Date | null;
  returnWindowDays: number;
  at: Date;
}

export interface ReturnLineEligibility {
  orderItemId: string;
  requestedQuantity: number;
  alreadyReturnedQuantity: number;
  returnableQuantity: number;
  eligible: boolean;
  reasonCode:
    "OK" | "NOT_DELIVERED" | "WINDOW_CLOSED" | "QUANTITY" | "NOT_RETURNABLE" | "NOT_IN_ORDER";
  message: string;
}

export interface ReturnEligibility {
  eligible: boolean;
  windowEndsAt: Date | null;
  lines: ReturnLineEligibility[];
  messages: string[];
}

/**
 * Validasi kelayakan retur: status pengiriman, tanggal, sisa qty yang bisa diretur,
 * dan kebijakan kategori. AT-08 membutuhkan alokasi diskon per baris.
 */
export function evaluateReturnEligibility(input: ReturnEligibilityInput): ReturnEligibility {
  const { order, at } = input;
  const messages: string[] = [];
  const windowEndsAt = order.deliveredAt
    ? addDays(order.deliveredAt, Math.max(1, Math.trunc(input.returnWindowDays)))
    : null;
  const windowOpen = windowEndsAt === null || at.getTime() <= windowEndsAt.getTime();
  const deliveredish = [
    "delivered",
    "completed",
    "return_requested",
    "return_approved",
    "returned",
  ].includes(order.status);
  const byId = new Map(order.lines.map((l) => [l.orderItemId, l]));

  const lines: ReturnLineEligibility[] = input.orderItemIds.map((orderItemId) => {
    const line = byId.get(orderItemId);
    const requested = Math.trunc(input.quantities[orderItemId] ?? 0);
    if (!line) {
      return {
        orderItemId,
        requestedQuantity: requested,
        alreadyReturnedQuantity: 0,
        returnableQuantity: 0,
        eligible: false,
        reasonCode: "NOT_IN_ORDER",
        message: "Item tidak ditemukan pada pesanan ini.",
      };
    }
    const alreadyReturned = Math.max(
      0,
      Math.trunc(input.alreadyReturnedQuantities?.[orderItemId] ?? 0),
    );
    const returnable = Math.max(0, line.quantity - alreadyReturned);
    const base: Omit<ReturnLineEligibility, "eligible" | "reasonCode" | "message"> = {
      orderItemId,
      requestedQuantity: requested,
      alreadyReturnedQuantity: alreadyReturned,
      returnableQuantity: returnable,
    };
    if (!line.isReturnable) {
      return {
        ...base,
        eligible: false,
        reasonCode: "NOT_RETURNABLE",
        message: `${line.nameSnapshot} tidak dapat diretur sesuai kebijakan kategori ini.`,
      };
    }
    if (!deliveredish) {
      return {
        ...base,
        eligible: false,
        reasonCode: "NOT_DELIVERED",
        message: "Retur dapat diajukan setelah pesanan berstatus tiba di alamat.",
      };
    }
    if (!windowOpen) {
      return {
        ...base,
        eligible: false,
        reasonCode: "WINDOW_CLOSED",
        message: "Batas waktu retur sudah lewat.",
      };
    }
    if (requested <= 0) {
      return {
        ...base,
        eligible: false,
        reasonCode: "QUANTITY",
        message: "Pilih jumlah yang ingin diretur.",
      };
    }
    if (requested > returnable) {
      return {
        ...base,
        eligible: false,
        reasonCode: "QUANTITY",
        message: `Jumlah yang dapat diretur maksimal ${returnable} untuk ${line.nameSnapshot}.`,
      };
    }
    return { ...base, eligible: true, reasonCode: "OK", message: "Memenuhi syarat retur." };
  });

  if (lines.length === 0) messages.push("Pilih minimal satu item yang ingin diretur.");
  if (lines.some((l) => !l.eligible))
    messages.push("Beberapa item belum memenuhi syarat; lihat keterangan per baris.");

  return {
    eligible: lines.length > 0 && lines.every((l) => l.eligible),
    windowEndsAt,
    lines,
    messages,
  };
}

/**
 * Pemanggil menyediakan qty yang sudah diretur sebelumnya (dari DB) supaya fungsi ini tetap murni.
 */
export function remainingReturnableQuantity(quantity: number, alreadyReturned: number): number {
  return Math.max(0, Math.trunc(quantity) - Math.max(0, Math.trunc(alreadyReturned)));
}

/**
 * Nilai refund untuk retur parsial.
 * Per baris: (lineTotal - diskon dialokasikan) x qtyDiretur/qtyDibeli, dibulat half-up.
 * Ongkir hanya ikut dikembalikan bila alasan retur adalah kesalahan penjual (kebijakan di RETURN_REASONS).
 * Hasil SELALU di-cap refundable order (Blueprint §9.1).
 */
export function computeReturnRefund(input: {
  order: OrderSnapshot;
  lines: Array<{ orderItemId: string; returnQuantity: number }>;
  includeShipping: boolean;
}): { amount: number; capped: boolean; refundable: number } {
  const byId = new Map(input.order.lines.map((l) => [l.orderItemId, l]));
  let amount = 0;
  for (const requested of input.lines) {
    const line = byId.get(requested.orderItemId);
    if (!line) continue;
    const qty = Math.max(0, Math.trunc(requested.returnQuantity));
    if (qty === 0) continue;
    const refundableLine = lineRefundable(line);
    amount += roundHalfUp(
      (refundableLine * Math.min(qty, line.quantity)) / Math.max(1, line.quantity),
    );
  }
  if (input.includeShipping) amount += Math.max(0, Math.trunc(input.order.shippingAmount));

  const refundable = Math.max(0, input.order.totalAmount - input.order.refundedAmount);
  const capped = amount > refundable;
  return { amount: capped ? refundable : amount, capped, refundable };
}

export function shouldRefundShipping(reasonCode: string): boolean {
  return RETURN_REASONS.find((r) => r.code === reasonCode)?.refundShippingPolicy === "refund";
}

/** Stok jual hanya bertambah setelah pemeriksaan; barang rusak ditandai tidak dapat dijual. */
export function shouldRestockOnResolution(
  resolution: ReturnResolution,
  inspectionPassed: boolean,
  isDamaged: boolean,
): boolean {
  if (!inspectionPassed) return false;
  if (isDamaged) return false;
  return resolution === "refund" || resolution === "exchange" || resolution === "store_credit";
}

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  requested: "Menunggu peninjauan",
  approved: "Disetujui - kirim barang",
  rejected: "Ditolak",
  awaiting_return: "Menunggu barang diterima",
  item_received: "Barang diterima",
  inspected: "Selesai diperiksa",
  resolved: "Selesai",
  cancelled: "Dibatalkan",
};

export function assertReturnTransition(from: ReturnStatus, to: ReturnStatus): void {
  const allowed: Record<ReturnStatus, ReturnStatus[]> = {
    requested: ["approved", "rejected", "cancelled"],
    approved: ["awaiting_return", "cancelled"],
    awaiting_return: ["item_received", "cancelled"],
    item_received: ["inspected", "rejected"],
    inspected: ["resolved", "rejected"],
    rejected: [],
    resolved: [],
    cancelled: [],
  };
  if (!(allowed[from] ?? []).includes(to)) {
    throw new AppError(
      "INVALID_STATE_TRANSITION",
      `Status retur ${from} tidak dapat diubah ke ${to}.`,
      {
        status: 422,
        details: { allowed: allowed[from] ?? [] },
      },
    );
  }
}

export function returnWindowEndsAt(deliveredAt: Date | null, days: number): Date | null {
  if (!deliveredAt) return null;
  return new Date(deliveredAt.getTime() + Math.max(1, Math.trunc(days)) * DAY_MS);
}
