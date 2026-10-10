import "server-only";

/**
 * Konfigurasi runtime. Blueprint §13.1: secret HANYA dari environment, tidak pernah di repo.
 * Nilai dev diberi default non-rahasia dan ditandai; produksi menolak boot jika kosong.
 */

/**
 * Guard "wajib secret" hanya untuk proses server yang benar-benar melayani request.
 * `next build` berjalan dengan NODE_ENV=production; bila guard aktif di fase itu, build gagal
 * padahal tidak ada transaksi yang diproses (dan rahasia tidak boleh dibakar ke artefak build).
 */
const isBuildPhase =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.argv.some((arg) => String(arg).includes("next build"));

const isProduction = process.env.NODE_ENV === "production" && !isBuildPhase;

function required(name: string, value: string | undefined, fallbackForDev: string): string {
  if (value && value.trim().length > 0) return value.trim();
  if (isProduction) {
    throw new Error(
      `Konfigurasi wajib belum diisi: ${name}. Isi lewat environment secret (lihat .env.example).`,
    );
  }
  return fallbackForDev;
}

function intEnv(name: string, value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const env = {
  isProduction,
  appName: process.env.NEXT_PUBLIC_APP_NAME?.trim() || "NOVA STORE",
  appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000",
  locale: process.env.NEXT_PUBLIC_DEFAULT_LOCALE?.trim() || "id-ID",
  currency: (process.env.NEXT_PUBLIC_DEFAULT_CURRENCY?.trim() || "IDR") as "IDR",
  dataDriver: (process.env.DATA_DRIVER === "postgres" ? "postgres" : "pglite") as
    "pglite" | "postgres",
  pgliteDir: process.env.PGLITE_DIR?.trim() || ".data/pglite",
  databaseUrl: process.env.DATABASE_URL?.trim() ?? "",
  databasePoolMax: intEnv("DATABASE_POOL_MAX", process.env.DATABASE_POOL_MAX, 10),
  authSecret: required(
    "AUTH_SECRET",
    process.env.AUTH_SECRET,
    "dev-only-insecure-secret-change-me-32bytes",
  ),
  sessionTtlHours: intEnv("SESSION_TTL_HOURS", process.env.SESSION_TTL_HOURS, 12),
  adminSessionTtlHours: intEnv("ADMIN_SESSION_TTL_HOURS", process.env.ADMIN_SESSION_TTL_HOURS, 4),
  authMaxFailedAttempts: intEnv(
    "AUTH_MAX_FAILED_ATTEMPTS",
    process.env.AUTH_MAX_FAILED_ATTEMPTS,
    8,
  ),
  authLockoutMinutes: intEnv("AUTH_LOCKOUT_MINUTES", process.env.AUTH_LOCKOUT_MINUTES, 15),
  requireMfaForStaff: (process.env.REQUIRE_MFA_FOR_STAFF ?? "true") !== "false",
  operatorTimezone: process.env.OPERATOR_TIMEZONE?.trim() || "Asia/Jakarta",
  refundAutoApproveLimit: intEnv(
    "REFUND_AUTO_APPROVE_LIMIT",
    process.env.REFUND_AUTO_APPROVE_LIMIT,
    500_000,
  ),
  paymentTimeoutMinutes: intEnv(
    "ORDER_PAYMENT_TIMEOUT_MINUTES",
    process.env.ORDER_PAYMENT_TIMEOUT_MINUTES,
    60,
  ),
  reservationTtlMinutes: intEnv(
    "STOCK_RESERVATION_TTL_MINUTES",
    process.env.STOCK_RESERVATION_TTL_MINUTES,
    30,
  ),
  returnWindowDays: intEnv("RETURN_WINDOW_DAYS", process.env.RETURN_WINDOW_DAYS, 14),
  lowStockDefault: intEnv(
    "LOW_STOCK_DEFAULT_THRESHOLD",
    process.env.LOW_STOCK_DEFAULT_THRESHOLD,
    5,
  ),
  defaultLocationCode: process.env.DEFAULT_LOCATION_CODE?.trim() || "MAIN",
  paymentProvider: (process.env.PAYMENT_PROVIDER?.trim() || "mock") as
    "mock" | "midtrans" | "xendit",
  mockWebhookSecret: required(
    "MOCK_WEBHOOK_SECRET",
    process.env.MOCK_WEBHOOK_SECRET,
    "dev-only-mock-webhook-secret",
  ),
  shippingProvider: (process.env.SHIPPING_PROVIDER?.trim() || "mock") as "mock" | "biteship",
  notifySink: (process.env.NOTIFY_SINK?.trim() || "log") as "log" | "smtp",
  logLevel: process.env.LOG_LEVEL?.trim() || "info",
  /** true bila driver data adalah engine dev tertanam (pglite) - dipakai untuk penanda UI/ops. */
  isEmbeddedDatabase: process.env.DATA_DRIVER !== "postgres",
};

export const usingInsecureDevSecret = !isProduction && !process.env.AUTH_SECRET;
