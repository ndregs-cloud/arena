/**
 * Jam terinjeksi (Blueprint §17.3: "Gunakan deterministic clocks untuk test expiration promo,
 * reservation TTL, token expiry"). Semua aturan waktu memakai Clock, bukan Date.now() langsung.
 */

export interface Clock {
  now(): Date;
  nowMs(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
};

export function fixedClock(iso: string | number): Clock & { advance(minutes: number): void } {
  let current = typeof iso === "number" ? iso : Date.parse(iso);
  return {
    now: () => new Date(current),
    nowMs: () => current,
    advance(minutes: number) {
      current += Math.round(minutes * 60_000);
    },
  };
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function isWithin(
  window: { startsAt?: Date | null; endsAt?: Date | null },
  at: Date,
): boolean {
  const t = at.getTime();
  if (window.startsAt && t < window.startsAt.getTime()) return false;
  // Batas akhir bersifat INKLUSIF sampai detik terakhir (didefinisikan di dokumen aturan promo).
  if (window.endsAt && t > window.endsAt.getTime()) return false;
  return true;
}
