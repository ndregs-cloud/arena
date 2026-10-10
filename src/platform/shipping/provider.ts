import "server-only";
import type { ShipmentStatus } from "@/domain/shipping";

/** Kontrak adapter pengiriman (Blueprint §7.2, §11.4). Domain tidak tahu nama kurir. */

export interface QuoteRequest {
  province: string;
  city: string;
  district: string;
  postalCode: string;
  weightGrams: number;
  itemCount: number;
}

export interface QuoteService {
  carrierCode: string;
  serviceCode: string;
  serviceName: string;
  costAmount: number;
  estimateLabel: string;
  /** true = angka berasal dari kartu tarif simulasi internal, bukan tarif kurir. */
  isSimulated: boolean;
}

export interface ShippingQuoteResult {
  services: QuoteService[];
  quotedAt: Date;
  expiresAt: Date;
  source: "provider" | "simulated" | "fallback_manual";
  warning: string | null;
}

export interface TrackingResult {
  shipmentRef: string;
  status: ShipmentStatus | null;
  events: Array<{
    status: ShipmentStatus | null;
    rawStatus: string;
    label: string;
    location: string | null;
    occurredAt: Date;
  }>;
  source: "provider" | "manual" | "simulated";
}

export interface ShippingProviderAdapter {
  readonly code: "mock" | "biteship";
  readonly isSimulated: boolean;
  readonly displayName: string;
  unavailableReason(): string | null;
  quote(request: QuoteRequest): Promise<ShippingQuoteResult>;
  createShipment?(input: {
    orderNumber: string;
    trackingRef: string;
    weightGrams: number;
  }): Promise<{ labelRef: string | null; trackingNumber: string | null }>;
  track(trackingNumber: string, carrierCode: string): Promise<TrackingResult | null>;
}
