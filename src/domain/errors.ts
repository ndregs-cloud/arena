/**
 * Kontrak error seragam (Blueprint §11.2).
 * Klien hanya boleh melihat code + message aman; tanpa stack trace, SQL, atau detail provider.
 */

export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "STOCK_INSUFFICIENT",
  "VARIANT_REQUIRED",
  "PRODUCT_NOT_PUBLISHED",
  "CART_EMPTY",
  "PROMO_INVALID",
  "PROMO_EXPIRED",
  "PROMO_LIMIT_REACHED",
  "SHIPPING_QUOTE_EXPIRED",
  "SHIPPING_PROVIDER_UNAVAILABLE",
  "PAYMENT_PROVIDER_UNAVAILABLE",
  "PAYMENT_ALREADY_TERMINAL",
  "PAYMENT_NOT_CONFIRMED",
  "REFUND_EXCEEDS_REFUNDABLE",
  "APPROVAL_REQUIRED",
  "INVALID_STATE_TRANSITION",
  "IDEMPOTENCY_CONFLICT",
  "CSRF_ORIGIN_REJECTED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  /** true = error domain (input/user/state), bukan kegagalan sistem. */
  readonly isExpected: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? defaultStatus(code);
    this.details = options.details;
    this.isExpected = this.status < 500;
    if (options.cause !== undefined) {
      (this as unknown as { cause?: unknown }).cause = options.cause;
    }
  }

  toPayload(requestId?: string): ErrorPayload {
    return {
      code: this.code,
      message: this.message,
      requestId,
      details: this.details,
    };
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case "VALIDATION_FAILED":
    case "VARIANT_REQUIRED":
    case "PROMO_INVALID":
    case "PROMO_EXPIRED":
    case "INVALID_STATE_TRANSITION":
    case "REFUND_EXCEEDS_REFUNDABLE":
    case "APPROVAL_REQUIRED":
    case "PAYMENT_NOT_CONFIRMED":
    case "IDEMPOTENCY_CONFLICT":
    case "CART_EMPTY":
      return 422;
    case "STOCK_INSUFFICIENT":
    case "PRODUCT_NOT_PUBLISHED":
    case "CONFLICT":
    case "SHIPPING_QUOTE_EXPIRED":
      return 409;
    case "UNAUTHENTICATED":
      return 401;
    case "PERMISSION_DENIED":
    case "CSRF_ORIGIN_REJECTED":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "RATE_LIMITED":
      return 429;
    case "PAYMENT_PROVIDER_UNAVAILABLE":
    case "SHIPPING_PROVIDER_UNAVAILABLE":
      return 502;
    case "PROMO_LIMIT_REACHED":
      return 422;
    case "INTERNAL_ERROR":
    default:
      return 500;
  }
}

export function appError(payload: ErrorPayload): AppError {
  return new AppError(payload.code, payload.message, { details: payload.details });
}

/** Pesan aman untuk klien dari error tak dikenal (tidak membocorkan detail internal). */
export function toClientError(
  error: unknown,
  fallbackMessage = "Terjadi kesalahan. Silakan coba lagi.",
): ErrorPayload {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof Error && error.name === "ZodError") {
    return { code: "VALIDATION_FAILED", message: "Periksa kembali isian Anda." };
  }
  return { code: "INTERNAL_ERROR", message: fallbackMessage };
}
