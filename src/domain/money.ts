/**
 * Uang sebagai integer. Blueprint §9.4:
 * "Gunakan integer minor units untuk uang; hindari floating-point sebagai sumber kebenaran moneter."
 *
 * Konvensi ndre.gstore (IDR ritel Indonesia):
 * - Satuan penyimpanan = 1 Rupiah penuh ("sen" tidak ditagihkan pada VA/QRIS/kartu di merchant lokal).
 * - Semua kolom DB bernama `*_amount` menyimpan integer ini; `currency` selalu disimpan eksplisit.
 * - Pembulatan hanya terjadi di fungsi domain ini (half-up), tidak di komponen UI.
 */

export const CURRENCIES = ["IDR"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const DEFAULT_CURRENCY: CurrencyCode = "IDR";

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export interface Money {
  amount: number;
  currency: CurrencyCode;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Validasi bahwa nilai adalah integer aman (bukan float, NaN, atau melebihi presisi JS). */
export function assertAmount(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Nilai uang harus integer aman, diterima: ${String(value)}`);
  }
  if (value < 0) {
    throw new MoneyError(`Nilai uang tidak boleh negatif, diterima: ${String(value)}`);
  }
  if (value > MAX_SAFE) {
    throw new MoneyError("Nilai uang melebihi batas presisi aman");
  }
  return value;
}

export function money(amount: number, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  return { amount: assertAmount(amount), currency };
}

/** Pembulatan half-up: 0.5 naik. Deterministik dan diuji (AT-13 membutuhkan determinisme). */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) throw new MoneyError("Pembulatan menerima nilai non-finite");
  return Math.sign(value) === -1
    ? -Math.round(Math.abs(value) + Number.EPSILON)
    : Math.round(value + Number.EPSILON);
}

export function sumAmount(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + assertAmount(v), 0);
}

/**
 * Persen berbasis basis point (integer) agar tidak ada galat float pada diskon.
 * contoh: applyBasisPoints(899_000, 1_000) => diskon 10% = 89_900.
 */
export function applyBasisPoints(base: number, basisPoints: number): number {
  assertAmount(base);
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new MoneyError(`basisPoints harus integer 0..10000, diterima: ${String(basisPoints)}`);
  }
  return roundHalfUp((base * basisPoints) / 10_000);
}

/**
 * Alokasi jumlah (mis. diskon) ke beberapa baris secara proporsional memakai metode
 * "largest remainder" sehingga jumlah alokasi PERSIS sama dengan total (tidak ada rupiah hilang).
 * Dipakai untuk menghitung nilai refundable per baris (AT-08).
 */
export function allocateByWeights(total: number, weights: readonly number[]): number[] {
  const target = assertAmount(total);
  if (weights.length === 0) return [];
  const normalized = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const weightSum = normalized.reduce((a, b) => a + b, 0);
  if (weightSum === 0) {
    // Tidak ada bobot: bagi rata, sisa diberikan ke baris pertama.
    const per = Math.floor(target / normalized.length);
    const out = normalized.map(() => per);
    const first = out[0] ?? 0;
    out[0] = first + (target - per * normalized.length);
    return out;
  }
  const exact = normalized.map((w) => (target * w) / weightSum);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = target - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac === a.frac ? a.i - b.i : b.frac - a.frac));
  const result = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] = (result[i] ?? 0) + 1;
    remainder -= 1;
  }
  return result.map((v) => assertAmount(v));
}

/** Clamp nilai diskon agar tidak pernah melebihi subtotal. */
export function clampDiscount(requested: number, subtotal: number): number {
  const s = assertAmount(subtotal);
  const d = assertAmount(requested);
  return Math.min(d, s);
}

export function isPositiveAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function formatMinorHint(): string {
  return "Semua angka uang pada sistem ini adalah integer Rupiah (tanpa sen).";
}
