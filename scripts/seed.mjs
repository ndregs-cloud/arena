#!/usr/bin/env node
/**
 * CLI seed dev/test. Mengisi DB dengan katalog, RBAC, promosi, kebijakan, pengaturan,
 * akun demo, dan order contoh (semua ditandai "data contoh", bukan transaksi nyata).
 * Jalankan: node scripts/seed.mjs [--force]
 */
import { resolve } from "node:path";
import { loadEnv, migrate, openDb } from "./db-lib.mjs";
import { seedAll, DEV_TOTP_SECRET } from "./seed-core.mjs";
import { CATEGORIES, PRODUCTS, ATTRIBUTE_DEFINITIONS } from "./seed-catalog.mjs";

const force = process.argv.slice(2).includes("--force");
await loadEnv();

const authSecret = process.env.AUTH_SECRET?.trim() || "dev-only-insecure-secret-change-me-32bytes";
const password = process.env.SEED_DEV_PASSWORD?.trim() || generatePassword();
if (!process.env.SEED_DEV_PASSWORD?.trim()) {
  console.log(
    "Catatan: SEED_DEV_PASSWORD tidak diisi - kata sandi akun demo dibuat acak dan dicetak sekali di bawah.",
  );
}

const root = resolve(import.meta.dirname, "..");
const db = await openDb({
  driver: process.env.DATA_DRIVER === "postgres" ? "postgres" : "pglite",
  databaseUrl: process.env.DATABASE_URL,
  pgliteDir: process.env.PGLITE_DIR || ".data/pglite",
});
try {
  await migrate(db, { log: () => {} });
  const counts = await db.query(
    `SELECT (SELECT count(*)::int FROM products) AS products, (SELECT count(*)::int FROM orders) AS orders`,
  );
  const existingProducts = Number(counts.rows[0]?.products ?? 0);
  if (existingProducts > 0 && !force) {
    console.log(
      `Seed dilewati: sudah ada ${existingProducts} produk (dan ${counts.rows[0]?.orders ?? 0} order).`,
    );
    console.log("Gunakan `node scripts/seed.mjs --force` untuk mengosongkan lalu mengisi ulang.");
    process.exitCode = 0;
  } else {
    if (force) {
      const tables = [
        "privacy_requests",
        "return_items",
        "return_events",
        "returns",
        "refund_items",
        "refunds",
        "tracking_events",
        "shipment_items",
        "shipments",
        "payment_webhook_events",
        "payment_attempts",
        "stock_reservations",
        "stock_adjustment_requests",
        "order_items",
        "order_events",
        "orders",
        "coupon_redemptions",
        "promotions",
        "inventory_movements",
        "inventory_balances",
        "product_media",
        "product_review_stats",
        "reviews",
        "price_history",
        "product_variants",
        "products",
        "category_attributes",
        "attribute_definitions",
        "campaign_banners",
        "cms_pages",
        "newsletter_subscriptions",
        "wishlist_items",
        "wishlists",
        "consent_records",
        "notification_outbox",
        "integration_outbox",
        "audit_logs",
        "auth_tokens",
        "sessions",
        "addresses",
        "user_roles",
        "customer_profiles",
        "users",
        "site_settings",
        "policies",
        "categories",
      ];
      for (const table of tables)
        await db.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`).catch(() => {});
      console.log("Mode --force: tabel bisnis dikosongkan.");
    }
    const summary = await seedAll(db, {
      password,
      authSecret,
      catalog: { CATEGORIES, PRODUCTS, ATTRIBUTE_DEFINITIONS },
      imagesRoot: root,
    });
    printSummary({ summary, password, authSecret });
  }
} catch (error) {
  console.error(
    "SEED GAGAL:",
    error instanceof Error ? error.message : String(error).slice(0, 400),
  );
  process.exitCode = 1;
} finally {
  await db.close();
}

function generatePassword() {
  const { randomBytes } = globalThis.crypto ?? {};
  const raw = randomBytes
    ? Buffer.from(randomBytes(9)).toString("base64url")
    : `dev-${Date.now()}-seed`;
  return `Sd${raw.replace(/[-_]/g, "k")}9`;
}

function printSummary({ summary, password, authSecret }) {
  const line = "─".repeat(74);
  console.log(`\n${line}`);
  console.log("SEED SELESAI - ndre.gstore (data dev/test, BUKAN data produksi)");
  console.log(line);
  console.log(
    `produk: ${summary.products} | varian: ${summary.variants} | order contoh: ${summary.orders} | akun: ${summary.users.length + 1}`,
  );
  console.log(`\nKata sandi SEMUA akun demo: ${password}`);
  console.log("Setelah dicetak, simpan di tempat aman; nilai ini tidak ditulis ke repository.");
  console.log(`\nAkun (email / peran):`);
  for (const user of summary.users) console.log(`  ${user.email.padEnd(30)} ${user.role}`);
  console.log(`\nStaf memakai MFA TOTP dengan secret dev tetap: ${DEV_TOTP_SECRET}`);
  console.log(`Cetak kode 6 angka saat ini: node scripts/dev-totp.mjs`);
  console.log(`(Bila ingin mematikan syarat MFA untuk staf di dev: REQUIRE_MFA_FOR_STAFF=false)`);
  console.log(
    `\nDriver data: ${process.env.DATA_DRIVER ?? "pglite"}  |  AUTH_SECRET: ${authSecret === "dev-only-insecure-secret-change-me-32bytes" ? "default dev (tidak aman, jangan untuk produksi)" : "diisi dari environment"}`,
  );
  console.log(`${line}\n`);
}
