import { DEFAULT_CURRENCY, type CurrencyCode } from "@/domain/money";

/**
 * Format tampilan untuk pasar Indonesia (Blueprint §14, desain §18.3 content constraints).
 * id-ID, Rupiah tanpa desimal, tanggal Indonesia, zona waktu operasional.
 */

export const LOCALE = "id-ID";
export const OPERATOR_TIMEZONE = process.env.OPERATOR_TIMEZONE ?? "Asia/Jakarta";

const idrFormatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: OPERATOR_TIMEZONE,
});

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: OPERATOR_TIMEZONE,
  hour12: false,
});

/** Uang selalu integer Rupiah; format() menolak NaN/float agar bug cepat terlihat. */
export function formatIDR(amount: number, _currency: CurrencyCode = DEFAULT_CURRENCY): string {
  if (!Number.isFinite(amount)) return "Rp0";
  return idrFormatter.format(Math.round(amount));
}

export function formatAmountShort(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000)
    return `${(amount / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1).replace(".", ",")} M`;
  if (abs >= 1_000_000)
    return `${(amount / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(".", ",")} jt`;
  if (abs >= 1_000) return `${Math.round(amount / 1_000)} rb`;
  return numberFormatter.format(amount);
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatPercent(value: number): string {
  return `${value.toLocaleString(LOCALE, { maximumFractionDigits: 1 })}%`;
}

export function formatDate(value: Date | string | null | undefined): string {
  const d = toDate(value);
  return d ? dateFormatter.format(d) : "-";
}

export function formatDateTime(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return "-";
  return `${dateFormatter.format(d)}, ${dateTimeFormatter.format(d).split(", ").pop() ?? ""} WIB`;
}

export function formatTime(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return "-";
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: OPERATOR_TIMEZONE,
    hour12: false,
  }).format(d);
}

/** "3 menit lalu" - dipakai di timeline order/admin (Blueprint §8.1 freshness). */
export function formatRelative(
  value: Date | string | null | undefined,
  at: Date = new Date(),
): string {
  const d = toDate(value);
  if (!d) return "-";
  const diffMin = Math.round((at.getTime() - d.getTime()) / 60_000);
  if (diffMin < 1) return "baru saja";
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours} jam lalu`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays} hari lalu`;
  return formatDate(d);
}

export function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Input "2026-10-09T14:30" (datetime-local) -> ISO UTC. */
export function localInputToUtcIso(value: string): string | null {
  if (!value) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function utcIsoToLocalInput(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return "";
  const shifted = new Date(d.getTime() + 7 * 3_600_000); // WIB = UTC+7, tanpa DST
  return shifted.toISOString().slice(0, 16);
}

export function formatRating(value: number | null | undefined, count?: number): string {
  if (value === null || value === undefined) return "Belum ada ulasan";
  const score = value.toFixed(1).replace(".", ",");
  if (typeof count === "number") return `${score} (${count} ulasan)`;
  return score;
}

/** Judul panjang tidak boleh merusak layout: dipotong dengan ellipsis, teks utuh ada di title attr. */
export function truncate(value: string, max = 60): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function pluralQuantity(count: number, unit: string): string {
  return `${numberFormatter.format(count)} ${unit}`;
}

export function maskCardLike(value: string): string {
  return value.replace(/\d{6,}/g, (m) => `${m.slice(0, 4)}****${m.slice(-2)}`);
}
