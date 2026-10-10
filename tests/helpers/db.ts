import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { getDb, resetDbForTests } from "@/platform/db";
import { seedAll } from "../../scripts/seed-core.mjs";
import { ATTRIBUTE_DEFINITIONS, CATEGORIES, PRODUCTS } from "../../scripts/seed-catalog.mjs";

export interface SeededFixture {
  db: Awaited<ReturnType<typeof getDb>>;
  summary: {
    users: Array<{ role: string; email: string }>;
    products: number;
    variants: number;
    orders: number;
  };
}

let cached: SeededFixture | null = null;

/** DB uji sekali per proses: bersihkan engine tertanam, migrasi otomatis, lalu seed. */
export async function seededDb(): Promise<SeededFixture> {
  if (cached) return cached;
  await rm(resolve(process.cwd(), ".data/pglite-test"), { recursive: true, force: true });
  const db = await getDb();
  const summary = await seedAll(db, {
    password: "PasswordUji-Dev-2026",
    authSecret: "test-secret-do-not-use-in-production",
    catalog: { CATEGORIES, PRODUCTS, ATTRIBUTE_DEFINITIONS },
    includeDemoOrders: true,
  });
  cached = { db, summary };
  return cached;
}

export async function closeDbForTests(): Promise<void> {
  cached = null;
  await resetDbForTests();
}
