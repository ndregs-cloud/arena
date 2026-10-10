import "server-only";
import type { PaymentAttemptStatus } from "@/domain/payments";

/**
 * Kontrak adapter pembayaran (Blueprint §6.2 "Gunakan payment adapter untuk mengisolasi
 * perbedaan provider", §11.4). Domain tidak boleh tahu nama vendor.
 */

export interface CreateAttemptInput {
  attemptId: string;
  orderNumber: string;
  amount: number;
  currency: "IDR";
  methodCode: string;
  customerEmail: string;
  customerName: string;
  returnUrl: string;
  webhookUrl: string;
  /** Sandbox scenario untuk mock: success | pending | failed | expired | duplicate | out_of_order */
  scenario?: string;
}

export interface ProviderAttemptResult {
  providerRef: string;
  status: Extract<
    PaymentAttemptStatus,
    "created" | "pending" | "requires_action" | "succeeded" | "failed"
  >;
  redirectUrl: string | null;
  instructions: string | null;
  /** true bila angka/status berasal dari simulasi lokal, bukan provider berizin. */
  isSimulated: boolean;
}

export interface ProviderInquiryResult {
  providerRef: string;
  status: PaymentAttemptStatus;
  amount: number;
  currency: "IDR";
  occurredAt: Date;
  rawEventId: string;
}

export interface ProviderRefundResult {
  providerRefundRef: string;
  status: "pending" | "succeeded" | "failed";
  isSimulated: boolean;
}

export interface WebhookVerification {
  valid: boolean;
  reason?: string;
  /** event id provider (untuk dedup) dan payload terurai. */
  eventId?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
}

export interface PaymentProviderAdapter {
  readonly code: "mock" | "midtrans" | "xendit";
  readonly isSimulated: boolean;
  readonly displayName: string;
  /** Pesan yang harus ditampilkan operator bila kredensial/kontrak belum tersedia. */
  unavailableReason(): string | null;
  createAttempt(input: CreateAttemptInput): Promise<ProviderAttemptResult>;
  inquire(providerRef: string): Promise<ProviderInquiryResult | null>;
  requestRefund(input: {
    attemptRef: string;
    amount: number;
    currency: "IDR";
    idempotencyKey: string;
  }): Promise<ProviderRefundResult>;
  /** Verifikasi signature HARUS memakai raw body (Blueprint §11.3). */
  verifyWebhook(rawBody: string, signature: string | null): WebhookVerification;
  normalizeEvent(payload: Record<string, unknown>): {
    providerRef: string;
    status: PaymentAttemptStatus;
    amount: number;
    currency: "IDR";
    eventId: string;
    kind: string;
    occurredAt: Date;
  } | null;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string, hint: string) {
    super(`Penyedia pembayaran "${provider}" belum dikonfigurasi. ${hint}`);
    this.name = "ProviderNotConfiguredError";
  }
}
