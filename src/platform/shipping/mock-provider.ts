import "server-only";
import { quoteSimulatedServices, type ShipmentStatus } from "@/domain/shipping";
import type {
  QuoteRequest,
  ShippingProviderAdapter,
  ShippingQuoteResult,
  TrackingResult,
} from "./provider";

/**
 * Adapter pengiriman SIMULASI (tarif internal + tracking manual).
 *
 * Penting (dokumen desain §20.1 "Shipping provider: tarif/estimasi dihitung dari provider;
 * jangan hardcode angka"): selama kontrak kurir/agregator belum ditandatangani, tarif di sini
 * adalah dasar perhitungan untuk menguji UX & alur, BUKAN harga kirim yang dapat ditagihkan.
 * UI menandai setiap kutipan dengan label "Simulasi" + peringatan, dan tracking hanya menerima
 * nomor resi yang diinput operator (tidak ada klaim status dari kurir nyata).
 */
export class MockShippingProvider implements ShippingProviderAdapter {
  readonly code = "mock" as const;
  readonly isSimulated = true;
  readonly displayName = "Tarif simulasi internal (belum terintegrasi kurir)";

  unavailableReason(): string | null {
    return null;
  }

  async quote(request: QuoteRequest): Promise<ShippingQuoteResult> {
    const now = new Date();
    const services = quoteSimulatedServices(
      {
        province: request.province,
        weightGrams: request.weightGrams,
        itemCount: request.itemCount,
      },
      now,
    ).map((s) => ({
      carrierCode: s.carrierCode,
      serviceCode: s.serviceCode,
      serviceName: s.serviceName,
      costAmount: s.costAmount,
      estimateLabel: s.estimateLabel,
      isSimulated: true,
    }));
    return {
      services,
      quotedAt: now,
      expiresAt: new Date(now.getTime() + 30 * 60_000),
      source: "simulated",
      warning: "Ongkir & estimasi adalah perhitungan simulasi internal, bukan tarif kurir resmi.",
    };
  }

  /** Tidak membuat label ke kurir: label hanya referensi internal. */
  async createShipment(input: { orderNumber: string; trackingRef: string; weightGrams: number }) {
    return {
      labelRef: `SIMLABEL-${input.orderNumber.slice(-6)}`,
      trackingNumber: input.trackingRef || null,
    };
  }

  async track(trackingNumber: string): Promise<TrackingResult | null> {
    if (!trackingNumber) return null;
    // Tidak ada sumber status eksternal: kembalikan kosong agar UI memakai event manual di DB.
    return { shipmentRef: trackingNumber, status: null, events: [], source: "manual" };
  }
}

/** Stub integrasi kurir nyata: fail-closed sampai kontrak + kredensial tersedia. */
export class HttpShippingProviderStub implements ShippingProviderAdapter {
  readonly isSimulated = false;
  constructor(
    readonly code: "biteship",
    readonly displayName: string,
    private readonly apiKey?: string,
    private readonly baseUrl?: string,
  ) {}

  unavailableReason(): string | null {
    if (!this.apiKey || !this.baseUrl) {
      return `Perlu API key + kontrak ${this.displayName} (rate, label, tracking, exception). Sementara gunakan SHIPPING_PROVIDER=mock.`;
    }
    return null;
  }

  async quote(): Promise<ShippingQuoteResult> {
    throw new Error(this.unavailableReason() ?? "Penyedia pengiriman belum siap");
  }

  async track(): Promise<TrackingResult | null> {
    throw new Error(this.unavailableReason() ?? "Penyedia pengiriman belum siap");
  }
}

export const SIMULATED_STATUSES: ShipmentStatus[] = [
  "created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
];
