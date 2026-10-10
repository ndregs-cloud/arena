import "server-only";
import { MockPaymentProvider } from "./mock-provider";
import type { PaymentAttemptStatus } from "@/domain/payments";
import type {
  CreateAttemptInput,
  PaymentProviderAdapter,
  ProviderAttemptResult,
  ProviderInquiryResult,
  ProviderRefundResult,
  WebhookVerification,
} from "./provider";
import { ProviderNotConfiguredError } from "./provider";

/**
 * Kerangka adapter provider HTTP nyata (Midtrans/Xendit/dll) yang SENGAJA tidak menebak kontrak vendor.
 *
 * Blueprint §10.4 & §13.2: integrasi harus memakai kontrak API + sandbox vendor yang benar.
 * Sebelum kontrak itu diverifikasi terhadap dokumentasi resmi vendor dan kredensial disediakan,
 * setiap panggilan sengaja gagal (fail-closed) alih-alih berpura-pura berhasil.
 *
 * Untuk mengaktifkan: isi BASE_URL/paths + key lewat environment (BUKAN file ini), lalu verifikasi
 * terhadap dokumentasi sandbox vendor: bentuk body, header auth, algoritma signature webhook,
 * field status, dan semantik refund/settlement.
 */
export class HttpPaymentProviderTemplate implements PaymentProviderAdapter {
  readonly isSimulated = false;
  constructor(
    readonly code: "midtrans" | "xendit",
    readonly displayName: string,
    private readonly config: {
      baseUrl?: string;
      serverKey?: string;
      webhookSecret?: string;
      paths?: { create: string; inquire: (ref: string) => string; refund: string };
    },
  ) {}

  unavailableReason(): string | null {
    if (!this.config.baseUrl || !this.config.serverKey) {
      return `Perlu BASE_URL + server key + kontrak API terverifikasi dari ${this.displayName}. Sementara gunakan PAYMENT_PROVIDER=mock.`;
    }
    if (!this.config.paths)
      return `Path API ${this.displayName} belum dipetakan dari dokumentasi resminya.`;
    return null;
  }

  private guard(): void {
    const reason = this.unavailableReason();
    if (reason) throw new ProviderNotConfiguredError(this.displayName, reason);
  }

  async createAttempt(_input: CreateAttemptInput): Promise<ProviderAttemptResult> {
    this.guard();
    throw new ProviderNotConfiguredError(
      this.displayName,
      "Kontrak request/response belum divalidasi terhadap sandbox vendor.",
    );
  }

  async inquire(_providerRef: string): Promise<ProviderInquiryResult | null> {
    this.guard();
    return null;
  }

  async requestRefund(_input: {
    attemptRef: string;
    amount: number;
    currency: "IDR";
    idempotencyKey: string;
  }): Promise<ProviderRefundResult> {
    this.guard();
    throw new ProviderNotConfiguredError(
      this.displayName,
      "Endpoint refund + idempotency key belum dikontrak.",
    );
  }

  verifyWebhook(_rawBody: string, _signature: string | null): WebhookVerification {
    this.guard();
    return { valid: false, reason: "PROVIDER_NOT_CONFIGURED" };
  }

  normalizeEvent(_payload: Record<string, unknown>) {
    this.guard();
    return null as null | {
      providerRef: string;
      status: PaymentAttemptStatus;
      amount: number;
      currency: "IDR";
      eventId: string;
      kind: string;
      occurredAt: Date;
    };
  }
}

/**
 * Factory: pilih provider dari environment. Default = mock (aman, tanpa kredensial).
 * Mock dipakai bila env kosong ATAU provider nyata belum terkonfigurasi, sehingga aplikasi
 * tetap dapat dijalankan tanpa mengarang status pembayaran.
 */
export function resolvePaymentProvider(): PaymentProviderAdapter {
  const code = (process.env.PAYMENT_PROVIDER ?? "mock").trim();
  if (code === "midtrans" || code === "xendit") {
    const upper = code.toUpperCase();
    const template = new HttpPaymentProviderTemplate(
      code,
      code === "midtrans" ? "Midtrans" : "Xendit",
      {
        baseUrl: process.env[`${upper}_BASE_URL`],
        serverKey: process.env[code === "midtrans" ? "MIDTRANS_SERVER_KEY" : "XENDIT_SECRET_KEY"],
        webhookSecret:
          process.env[code === "midtrans" ? "MIDTRANS_WEBHOOK_TOKEN" : "XENDIT_WEBHOOK_TOKEN"],
        paths: undefined, // sengaja: harus dipetakan dari dokumentasi resmi vendor
      },
    );
    // Fail-closed tapi tidak menjatuhkan storefront: kalau provider nyata belum siap, turun ke mock.
    return template.unavailableReason() ? new MockPaymentProvider() : template;
  }
  return new MockPaymentProvider();
}
