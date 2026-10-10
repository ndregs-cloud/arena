import type { ShippingZoneCode } from "@/domain/orders";
import { HOUR_MS, MINUTE_MS } from "@/domain/clock";

/**
 * Pengiriman. SANGAT PENTING: kartu tarif di bawah adalah SIMULASI internal untuk pengembangan
 * (Blueprint §10.2 "Shipping: kurir aggregator atau integrasi carrier", dokumen desain §20.1
 * "Tarif/estimasi dihitung dari provider; jangan hardcode angka").
 * Angka rupiah di sini BUKAN harga kurir nyata dan tidak boleh dipakai sebagai tarif produksi:
 * provider asli harus menggantikan adapter ini begitu kontrak/SLA vendor tersedia.
 */

export const SHIPPING_ZONES: Record<
  ShippingZoneCode,
  { label: string; baseDays: [number, number] }
> = {
  JAWA: { label: "Jawa", baseDays: [1, 3] },
  SUMATERA: { label: "Sumatera", baseDays: [2, 5] },
  BALI_NUSA: { label: "Bali & Nusa Tenggara", baseDays: [2, 5] },
  KALIMANTAN: { label: "Kalimantan", baseDays: [3, 6] },
  SULAWESI_TIMUR: { label: "Sulawesi & Indonesia Timur", baseDays: [3, 7] },
  PAPUA: { label: "Papua & Highland", baseDays: [5, 10] },
};

export const SHIPPING_SERVICES = [
  {
    code: "reg",
    name: "Reguler",
    perKgStart: 12_000,
    perKgExtra: 3_500,
    speedFactor: 1.0,
    maxWeightKg: 30,
  },
  {
    code: "yes",
    name: "Same Day (Simulasi)",
    perKgStart: 25_000,
    perKgExtra: 0,
    speedFactor: 0.2,
    maxWeightKg: 10,
  },
  {
    code: "kgo",
    name: "Kargo",
    perKgStart: 8_000,
    perKgExtra: 1_500,
    speedFactor: 1.8,
    maxWeightKg: 100,
  },
] as const;

export type ShippingServiceCode = (typeof SHIPPING_SERVICES)[number]["code"];

/** Zona tambahan (perkiraan jarak) -> dikalikan sebagai faktor biaya, bukan klaim tarif. */
const ZONE_COST_FACTOR: Record<ShippingZoneCode, number> = {
  JAWA: 1,
  SUMATERA: 1.35,
  BALI_NUSA: 1.45,
  KALIMANTAN: 1.6,
  SULAWESI_TIMUR: 1.85,
  PAPUA: 2.3,
};

export const PROVINCE_ZONE: Record<string, ShippingZoneCode> = {
  "DKI Jakarta": "JAWA",
  Banten: "JAWA",
  Jawa: "JAWA",
  "Jawa Barat": "JAWA",
  "Jawa Tengah": "JAWA",
  "DI Yogyakarta": "JAWA",
  "Jawa Timur": "JAWA",
  Aceh: "SUMATERA",
  "Sumatera Utara": "SUMATERA",
  "Sumatera Barat": "SUMATERA",
  Riau: "SUMATERA",
  "Kepulauan Riau": "SUMATERA",
  "Sumatera Selatan": "SUMATERA",
  Lampung: "SUMATERA",
  Bali: "BALI_NUSA",
  "Nusa Tenggara Barat": "BALI_NUSA",
  "Nusa Tenggara Timur": "BALI_NUSA",
  "Kalimantan Barat": "KALIMANTAN",
  "Kalimantan Selatan": "KALIMANTAN",
  "Kalimantan Timur": "KALIMANTAN",
  "Kalimantan Tengah": "KALIMANTAN",
  "Kalimantan Utara": "KALIMANTAN",
  Sulawesi: "SULAWESI_TIMUR",
  "Sulawesi Selatan": "SULAWESI_TIMUR",
  "Sulawesi Utara": "SULAWESI_TIMUR",
  "Sulawesi Tengah": "SULAWESI_TIMUR",
  "Sulawesi Tenggara": "SULAWESI_TIMUR",
  Gorontalo: "SULAWESI_TIMUR",
  Maluku: "SULAWESI_TIMUR",
  Papua: "PAPUA",
  "Papua Selatan": "PAPUA",
  "Papua Pegunungan": "PAPUA",
};

export function zoneForProvince(province: string): ShippingZoneCode {
  return PROVINCE_ZONE[province] ?? "JAWA";
}

export interface ShippingQuoteInput {
  province: string;
  weightGrams: number;
  itemCount: number;
}

export interface ShippingQuoteResult {
  carrierCode: "simulated";
  serviceCode: string;
  serviceName: string;
  costAmount: number;
  /** Selalu disebut "estimasi" - bukan janji tanggal (desain §9.1 Delivery estimate). */
  estimateLabel: string;
  quotedAt: Date;
  expiresAt: Date;
  isSimulated: true;
  zoneCode: ShippingZoneCode;
}

function ceilKg(weightGrams: number): number {
  return Math.max(1, Math.ceil(weightGrams / 1000));
}

export function quoteSimulatedServices(input: ShippingQuoteInput, at: Date): ShippingQuoteResult[] {
  const zoneCode = zoneForProvince(input.province);
  const zone = SHIPPING_ZONES[zoneCode];
  const kg = ceilKg(input.weightGrams);
  return SHIPPING_SERVICES.map((service) => {
    const factor = ZONE_COST_FACTOR[zoneCode] ?? 1;
    const extraKg = Math.max(0, kg - 1);
    const raw = (service.perKgStart + service.perKgExtra * extraKg) * factor;
    const costAmount = Math.round(raw / 500) * 500;
    const [minD, maxD] = zone ? zone.baseDays : ([2, 5] as [number, number]);
    const lo = Math.max(1, Math.round(minD * service.speedFactor));
    const hi = Math.max(lo, Math.round(maxD * service.speedFactor));
    return {
      carrierCode: "simulated" as const,
      serviceCode: service.code,
      serviceName: `${service.name} (Simulasi)`,
      costAmount,
      estimateLabel: `Estimasi ${lo}${hi !== lo ? `-${hi}` : ""} hari kerja`,
      quotedAt: at,
      // Kutipan berlaku 30 menit (Blueprint §6.1 shipping quote expiration).
      expiresAt: new Date(at.getTime() + 30 * MINUTE_MS),
      isSimulated: true as const,
      zoneCode,
    };
  }).filter((q) => q.costAmount > 0 || q.serviceCode !== "yes");
}

/** --- Tracking: pemetaan state provider -> internal, tanpa penurunan status (Blueprint §7.2) --- */

export const SHIPMENT_STATUSES = [
  "none",
  "created",
  "label_ready",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
  "returned_to_sender",
  "cancelled",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

const STATUS_RANK: Record<ShipmentStatus, number> = {
  none: 0,
  created: 1,
  label_ready: 2,
  picked_up: 3,
  in_transit: 4,
  out_for_delivery: 5,
  delivered: 6,
  exception: 4,
  returned_to_sender: 5,
  cancelled: 1,
};

/** Event yang datang tidak berurutan tidak boleh menurunkan status final (Blueprint §7.2). */
export function shouldApplyTrackingEvent(
  current: ShipmentStatus,
  incoming: ShipmentStatus,
): boolean {
  if (incoming === "exception") return current !== "delivered";
  if (current === "delivered") return false;
  return (STATUS_RANK[incoming] ?? 0) >= (STATUS_RANK[current] ?? 0);
}

export const PROVIDER_TRACKING_STATE_MAP: Record<string, ShipmentStatus> = {
  CREATED: "created",
  LABEL_CREATED: "label_ready",
  PICKED_UP: "picked_up",
  IN_TRANSIT: "in_transit",
  TRANSIT: "in_transit",
  OUT_FOR_DELIVERY: "out_for_delivery",
  DELIVERED: "delivered",
  RECEIVED: "delivered",
  EXCEPTION: "exception",
  DELIVERY_FAILED: "exception",
  RETURNED: "returned_to_sender",
  CANCELLED: "cancelled",
};

export function mapProviderTrackingState(raw: string | null | undefined): ShipmentStatus | null {
  if (!raw) return null;
  return PROVIDER_TRACKING_STATE_MAP[raw.toUpperCase()] ?? null;
}

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  none: "Belum dikirim",
  created: "Paket dibuat",
  label_ready: "Label siap",
  picked_up: "Diambil kurir",
  in_transit: "Dalam perjalanan",
  out_for_delivery: "Sedang diantar",
  delivered: "Terkirim",
  exception: "Terdapat kendala",
  returned_to_sender: "Dikirim balik ke penjual",
  cancelled: "Dibatalkan",
};

/** Kutipan dianggap basi setelah 30 menit; UI wajib memuat ulang. */
export function isQuoteExpired(expiresAt: Date | null, at: Date): boolean {
  if (!expiresAt) return false;
  return at.getTime() + HOUR_MS * 0 > expiresAt.getTime();
}
