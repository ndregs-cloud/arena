import "server-only";
import { verifyHmac } from "@/platform/crypto-helpers";
import { env } from "@/platform/env";
import { generateSimulatedVaNumber } from "@/domain/ids";
import type { PaymentAttemptStatus } from "@/domain/payments";
import { paymentMethodLabel } from "@/domain/payments";
import type {
  CreateAttemptInput,
  PaymentProviderAdapter,
  ProviderAttemptResult,
  ProviderInquiryResult,
  ProviderRefundResult,
  WebhookVerification,
} from "./provider";

/**
 * ADAPTER SIMULASI - bukan transaksi nyata.
 *
 * Semua nomor VA/billing diberi prefiks "SIMULASI", dan halaman sandbox hanya menerima
 * perintah eksplisit dari developer untuk menggerakkan status (success/pending/failed/...).
 * Tidak ada provider berizin, dana, atau pelanggan nyata yang terlibat (Blueprint §17.3:
 * "jangan membiarkan test menghubungi provider live").
 *
 * Webhook mock memakai HMAC-SHA256 atas raw body dengan MOCK_WEBHOOK_SECRET, sehingga jalur
 * verifikasi signature, dedup event, dan reconciliation dapat diuji sebelum vendor dipilih.
 */

const SCENARIOS = ["success", "pending", "failed", "expired", "duplicate", "out_of_order"] as const;
export type MockScenario = (typeof SCENARIOS)[number];

export function isMockScenario(value: string | undefined | null): value is MockScenario {
  return !!value && (SCENARIOS as readonly string[]).includes(value);
}

export class MockPaymentProvider implements PaymentProviderAdapter {
  readonly code = "mock" as const;
  readonly isSimulated = true;
  readonly displayName = "Simulasi lokal (bukan provider nyata)";

  unavailableReason(): string | null {
    return null;
  }

  async createAttempt(input: CreateAttemptInput): Promise<ProviderAttemptResult> {
    const scenario = isMockScenario(input.scenario) ? input.scenario : "pending";
    const providerRef = `SIM-${scenario}-${input.attemptId.slice(0, 8)}`;
    const methodLabel = paymentMethodLabel(input.methodCode);
    const instructions =
      input.methodCode === "sim_qris"
        ? `Tunjukkan kode QR simulasi ke aplikasi pembayaran (metode: ${methodLabel}). Nominal ${new Intl.NumberFormat("id-ID").format(input.amount)} Rupiah.`
        : `Transfer ke nomor billing ${generateSimulatedVaNumber(providerRef)} - SIMULASI, tidak ada rekening nyata (metode: ${methodLabel}).`;
    return {
      providerRef,
      status: scenario === "success" ? "succeeded" : scenario === "failed" ? "failed" : "pending",
      redirectUrl: `/simulasi-pembayaran/${input.attemptId}?scenario=${scenario}`,
      instructions,
      isSimulated: true,
    };
  }

  async inquire(providerRef: string): Promise<ProviderInquiryResult | null> {
    const parsed = /^SIM-(success|pending|failed|expired)-/.exec(providerRef);
    if (!parsed) return null;
    const statusMap: Record<string, PaymentAttemptStatus> = {
      success: "succeeded",
      pending: "pending",
      failed: "failed",
      expired: "expired",
    };
    return {
      providerRef,
      status: statusMap[parsed[1]!] ?? "pending",
      amount: 0, // inquiry mock tidak membawa nominal; cocokkan dari attempt internal
      currency: "IDR",
      occurredAt: new Date(),
      rawEventId: `inquiry:${providerRef}:${Date.now()}`,
    };
  }

  async requestRefund(input: {
    attemptRef: string;
    amount: number;
    currency: "IDR";
    idempotencyKey: string;
  }): Promise<ProviderRefundResult> {
    return {
      providerRefundRef: `SIM-REF-${input.idempotencyKey.slice(0, 8)}`,
      // Simulasi: submitted -> dispatcher outbox akan menandai succeeded setelah "konfirmasi".
      status: "pending",
      isSimulated: true,
    };
  }

  verifyWebhook(rawBody: string, signature: string | null): WebhookVerification {
    if (!signature) return { valid: false, reason: "MISSING_SIGNATURE" };
    const ok = verifyHmac(env.mockWebhookSecret, rawBody, signature);
    if (!ok) return { valid: false, reason: "BAD_SIGNATURE" };
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      return {
        valid: true,
        eventId: String(parsed.event_id ?? ""),
        eventType: String(parsed.event_type ?? ""),
        payload: parsed,
      };
    } catch {
      return { valid: false, reason: "MALFORMED_BODY" };
    }
  }

  normalizeEvent(payload: Record<string, unknown>) {
    const providerRef = payload.provider_ref ? String(payload.provider_ref) : null;
    if (!providerRef) return null;
    const eventKind = String(payload.event_type ?? "payment.pending");
    const statusByKind: Record<string, PaymentAttemptStatus> = {
      "payment.success": "succeeded",
      "payment.pending": "pending",
      "payment.failed": "failed",
      "payment.expired": "expired",
      "refund.success": "succeeded",
      "refund.failed": "failed",
    };
    return {
      providerRef,
      status: statusByKind[eventKind] ?? "pending",
      amount: Number(payload.amount ?? 0),
      currency: "IDR" as const,
      eventId: String(payload.event_id ?? providerRef),
      kind: eventKind,
      occurredAt: payload.occurred_at ? new Date(String(payload.occurred_at)) : new Date(),
    };
  }
}
