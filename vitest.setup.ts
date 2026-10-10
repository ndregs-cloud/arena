/**
 * Setup pengujian: environment dev yang aman.
 * Nilai ini harus ada SEBELUM modul platform (env) dimuat, karena `env` dibaca sekali di boot.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DATA_DRIVER = "pglite";
process.env.PGLITE_DIR = ".data/pglite-test";
process.env.AUTH_SECRET = "test-secret-do-not-use-in-production";
process.env.MOCK_WEBHOOK_SECRET = "test-mock-webhook-secret";
process.env.NOTIFY_SINK = "log";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.NEXT_PUBLIC_APP_NAME = "NOVA STORE";
process.env.REQUIRE_MFA_FOR_STAFF = "false";
process.env.ORDER_PAYMENT_TIMEOUT_MINUTES = "60";
process.env.STOCK_RESERVATION_TTL_MINUTES = "30";
process.env.REFUND_AUTO_APPROVE_LIMIT = "200000";
process.env.RETURN_WINDOW_DAYS = "14";

// React 19 + @testing-library/react: `render` memakai act(); flag ini wajib ada sebelum test jalan.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
