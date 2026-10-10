import { AppError } from "@/domain/errors";
import type { CurrencyCode } from "@/domain/money";

/**
 * Siklus pembayaran (Blueprint §6.2-§6.3). Order TIDAK pernah dianggap paid dari return URL browser;
 * hanya event provider terverifikasi + pencocokan nominal yang boleh mengubah status.
 */

export const PAYMENT_ATTEMPT_STATUSES = [
  "created",
  "pending",
  "requires_action",
  "succeeded",
  "failed",
  "expired",
  "cancelled",
  "refunded",
  "partially_refunded",
] as const;
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

export const REFUND_STATUSES = [
  "requested",
  "approved",
  "submitted",
  "pending",
  "succeeded",
  "failed",
  "rejected",
  "cancelled",
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export interface PaymentAttempt {
  id: string;
  orderId: string;
  orderNumber: string;
  providerCode: PaymentProviderCode;
  providerRef: string | null;
  methodCode: string;
  methodName: string;
  amount: number;
  currency: CurrencyCode;
  status: PaymentAttemptStatus;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
  succeededAt: Date | null;
  /** Instruksi pembayaran (VA/kode QR) - hanya untuk metode yang benar-benar tersedia. */
  instructions: string | null;
  redirectUrl: string | null;
  isSimulated: boolean;
  failureReason: string | null;
}

export type PaymentProviderCode = "mock" | "midtrans" | "xendit";

export const PAYMENT_METHODS = [
  {
    code: "sim_va",
    name: "Virtual Account (Simulasi)",
    kind: "va",
    description: "Transfer bank via nomor VA simulasi. Hanya untuk pengujian lokal.",
  },
  {
    code: "sim_qris",
    name: "QRIS (Simulasi)",
    kind: "qris",
    description: "Kode QR simulasi untuk menguji status pending -> berhasil.",
  },
  {
    code: "sim_card",
    name: "Kartu (Simulasi)",
    kind: "card",
    description: "Tanpa form kartu nyata: tidak ada PAN/CVV yang pernah diminta sistem ini.",
  },
] as const;
export type PaymentMethodCode = (typeof PAYMENT_METHODS)[number]["code"];

export function paymentMethodLabel(code: string): string {
  return PAYMENT_METHODS.find((m) => m.code === code)?.name ?? code;
}

const TERMINAL: PaymentAttemptStatus[] = [
  "succeeded",
  "failed",
  "expired",
  "cancelled",
  "refunded",
];

export function isTerminal(status: PaymentAttemptStatus): boolean {
  return TERMINAL.includes(status);
}

const ATTEMPT_TRANSITIONS: Record<PaymentAttemptStatus, PaymentAttemptStatus[]> = {
  created: ["pending", "requires_action", "failed", "expired", "cancelled", "succeeded"],
  pending: ["requires_action", "succeeded", "failed", "expired", "cancelled"],
  requires_action: ["pending", "succeeded", "failed", "expired", "cancelled"],
  succeeded: ["partially_refunded", "refunded"],
  failed: [],
  expired: [],
  cancelled: [],
  refunded: [],
  partially_refunded: ["refunded"],
};

export function assertAttemptTransition(
  from: PaymentAttemptStatus,
  to: PaymentAttemptStatus,
): void {
  const allowed = ATTEMPT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError(
      "PAYMENT_ALREADY_TERMINAL",
      `Status pembayaran ${from} tidak dapat diubah menjadi ${to}.`,
      {
        status: 422,
        details: { from, to, allowed },
      },
    );
  }
}

/** Deduplikasi webhook: provider + event id harus unik (Blueprint §6.3). */
export function webhookDedupeKey(provider: string, eventId: string): string {
  return `${provider}:${eventId}`;
}

export const WEBHOOK_EVENT_KINDS = [
  "payment.success",
  "payment.pending",
  "payment.failed",
  "payment.expired",
  "refund.success",
  "refund.failed",
] as const;
export type WebhookEventKind = (typeof WEBHOOK_EVENT_KINDS)[number];

export interface NormalizedPaymentEvent {
  provider: PaymentProviderCode;
  eventId: string;
  kind: WebhookEventKind;
  attemptRef: string;
  /** Nominal & mata uang WAJIB dicocokkan dengan attempt internal sebelum mengubah status. */
  amount: number;
  currency: CurrencyCode;
  occurredAt: Date;
  /** Payload minimal yang disimpan untuk audit (sudah diredaksi). */
  rawSummary: Record<string, unknown>;
}

export function assertEventMatchesAttempt(
  event: NormalizedPaymentEvent,
  attempt: PaymentAttempt,
): void {
  if (event.currency !== attempt.currency) {
    throw new AppError("CONFLICT", "Mata uang event pembayaran tidak cocok dengan tagihan.", {
      status: 409,
    });
  }
  if (event.amount !== attempt.amount) {
    throw new AppError(
      "CONFLICT",
      "Nominal event pembayaran tidak cocok dengan tagihan; masukkan ke antrean eksepsi.",
      {
        status: 409,
        details: { expected: attempt.amount, received: event.amount },
      },
    );
  }
}

/** AT-05: halaman kembali dari provider BUKAN bukti bayar. */
export function assertNotPaidFromBrowser(): never {
  throw new AppError(
    "PAYMENT_NOT_CONFIRMED",
    "Status sukses dari browser tidak dapat dipakai sebagai bukti pembayaran. Menunggu konfirmasi penyedia.",
    { status: 422 },
  );
}

export const REFUND_TRANSITIONS: Record<RefundStatus, RefundStatus[]> = {
  requested: ["approved", "rejected", "cancelled"],
  approved: ["submitted", "cancelled"],
  submitted: ["pending", "failed"],
  pending: ["succeeded", "failed"],
  succeeded: [],
  failed: ["submitted", "cancelled"],
  rejected: [],
  cancelled: [],
};

export function assertRefundTransition(from: RefundStatus, to: RefundStatus): void {
  const allowed = REFUND_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError(
      "INVALID_STATE_TRANSITION",
      `Status refund ${from} tidak dapat diubah ke ${to}.`,
      { status: 422, details: { allowed } },
    );
  }
}

/** Refund tidak boleh melebihi refundable (Blueprint §9.1). */
export function assertWithinRefundable(requestedAmount: number, refundableAmount: number): void {
  if (!Number.isSafeInteger(requestedAmount) || requestedAmount <= 0) {
    throw new AppError("VALIDATION_FAILED", "Nominal refund harus bilangan bulat positif.", {
      status: 422,
    });
  }
  if (requestedAmount > refundableAmount) {
    throw new AppError(
      "REFUND_EXCEEDS_REFUNDABLE",
      "Nominal refund melebihi nilai yang dapat dikembalikan.",
      {
        status: 422,
        details: { requestedAmount, refundableAmount },
      },
    );
  }
}

/** Nilai yang masih dapat dikembalikan: total - refund yang sudah tercatat. */
export function refundableAmountOfOrder(totalAmount: number, alreadyRefunded: number): number {
  return Math.max(0, Math.trunc(totalAmount) - Math.max(0, Math.trunc(alreadyRefunded)));
}

/** Maker-checker: refund >= ambang wajib disetujui aktor berbeda (Blueprint §3.1). */
export function requiresApproval(
  amount: number,
  autoApproveLimit: number,
  requesterId: string,
  approverId: string | null,
): boolean {
  if (amount <= autoApproveLimit) return false;
  if (!approverId) return true;
  return approverId === requesterId ? true : false;
}
