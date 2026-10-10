/**
 * Inventory sebagai ledger (Blueprint §7.1): stok bukan angka yang diedit manual tanpa alasan.
 * Available didefinisikan SATU kali di sini dan dipakai seluruh modul.
 */

export const MOVEMENT_KINDS = [
  "receipt",
  "reserve",
  "release",
  "pick",
  "ship",
  "return_to_stock",
  "damage",
  "undamage",
  "transfer_in",
  "transfer_out",
  "correction",
  "cycle_count",
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** Reason code terstandardisasi untuk adjustment (Blueprint §7.1). */
export const ADJUSTMENT_REASONS = [
  "cycle_count_variance",
  "damaged_found",
  "damaged_repaired",
  "theft_or_loss",
  "wrong_entry_fix",
  "supplier_shortage",
  "customer_return_damaged",
  "customer_return_resellable",
  "sample_or_internal_use",
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export interface BalanceLike {
  onHand: number;
  reserved: number;
  damaged: number;
  safetyStock: number;
}

/**
 * available = on_hand - reserved - safety_stock (min 0).
 * `damaged` tidak pernah ikut dihitung sebagai stok jual.
 */
export function availableToSell(balance: BalanceLike): number {
  const value = balance.onHand - balance.reserved - balance.safetyStock;
  return value > 0 ? value : 0;
}

export function isSellable(balance: BalanceLike, quantity = 1): boolean {
  return availableToSell(balance) >= quantity;
}

/** Konsumsi/pengurangan stok harus terjadi saat ship (Blueprint §9.2), reservasi saat order dibuat. */
export function applyMovement(
  balance: BalanceLike,
  movement: { kind: MovementKind; delta: number },
): BalanceLike {
  const delta = Math.trunc(movement.delta);
  const next = { ...balance };
  switch (movement.kind) {
    case "receipt":
    case "transfer_in":
      next.onHand += delta;
      break;
    case "damage":
      // delta positif = jumlah yang dipindahkan ke kuota rusak
      next.onHand -= Math.abs(delta);
      next.damaged += Math.abs(delta);
      break;
    case "undamage":
      next.damaged -= Math.abs(delta);
      next.onHand += Math.abs(delta);
      break;
    case "reserve":
      next.reserved += Math.abs(delta);
      break;
    case "release":
      next.reserved = Math.max(0, next.reserved - Math.abs(delta));
      break;
    case "pick":
      // picking mengurangi on_hand; reserved dilepas sekaligus saat ship
      next.onHand -= Math.abs(delta);
      break;
    case "ship":
      next.reserved = Math.max(0, next.reserved - Math.abs(delta));
      break;
    case "return_to_stock":
      next.onHand += Math.abs(delta);
      break;
    case "transfer_out":
      next.onHand -= Math.abs(delta);
      break;
    case "correction":
    case "cycle_count":
      next.onHand += delta;
      break;
  }
  if (next.onHand < 0 || next.reserved < 0 || next.damaged < 0 || next.safetyStock < 0) {
    return {
      onHand: Math.max(0, next.onHand),
      reserved: Math.max(0, next.reserved),
      damaged: Math.max(0, next.damaged),
      safetyStock: next.safetyStock,
    };
  }
  return next;
}

export interface AdjustmentIntent {
  sku: string;
  locationCode: string;
  delta: number;
  reason: AdjustmentReason;
  note?: string;
}

export function validateAdjustment(
  intent: AdjustmentIntent,
  current: BalanceLike,
): { ok: boolean; message?: string } {
  if (!Number.isInteger(intent.delta) || intent.delta === 0) {
    return {
      ok: false,
      message: "Perubahan stok harus bilangan bulat bukan nol (contoh: -2 atau 5).",
    };
  }
  if (!ADJUSTMENT_REASONS.includes(intent.reason)) {
    return {
      ok: false,
      message: "Alasan penyesuaian tidak dikenal. Pilih salah satu reason code.",
    };
  }
  if (intent.delta < 0 && availableToSell(current) < Math.abs(intent.delta)) {
    return {
      ok: false,
      message: `Pengurangan melebihi stok tersedia (available ${availableToSell(current)}). Gunakan reason "damaged_found" atau "theft_or_loss" dengan jumlah yang benar.`,
    };
  }
  return { ok: true };
}

/** Adjustment bernilai besar butuh persetujuan (maker-checker). Ambang dari site settings. */
export function requiresStockApproval(unitsAffected: number, threshold: number): boolean {
  return Math.abs(unitsAffected) >= threshold;
}

/** Reservasi punya TTL; jangan mengunci stok selamanya (Blueprint §7.1). */
export const RESERVATION_STATUSES = ["active", "consumed", "released", "expired"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export function isReservationExpired(expiresAt: Date, at: Date): boolean {
  return expiresAt.getTime() <= at.getTime();
}

export function reservationTtlMinutes(configured: number | undefined): number {
  const value = Math.trunc(configured ?? 30);
  return Math.min(Math.max(value, 5), 24 * 60);
}
