import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { env } from "@/platform/env";
import { log } from "@/platform/logger";

/**
 * Klien data tunggal untuk seluruh service (Blueprint §10.1 Persistence + §10.4 "kontrak layanan internal").
 *
 * Dua driver dengan SQL yang sama:
 * - pglite  : Postgres nyata tertanam (WASM) untuk local dev / test. Tidak butuh kredensial.
 *             Data disimpan di .data/pglite (sudah di-gitignore). BUKAN untuk produksi.
 * - postgres: PostgreSQL / Supabase-managed lewat DATABASE_URL. Wajib untuk staging & production.
 *
 * Catatan Supabase: gunakan koneksi transaction-mode (pgbouncer) + RLS bila akses langsung dipakai.
 */

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface DbClient extends Tx {
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

type Raw = {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number }>;
  exec?(sql: string): Promise<unknown>;
  transaction?<T>(
    fn: (tx: {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    }) => Promise<T>,
  ): Promise<T>;
  close?(): Promise<void>;
};

const insideTx = new AsyncLocalStorage<boolean>();

/**
 * Singleton per proses - disimpan di globalThis karena bundler bisa membuat SALINAN modul ini per
 * chunk (SSR/edge/route handler). Beberapa instance PGlite pada direktori yang sama membuat WASM
 * membatalkan dirinya (RuntimeError: Aborted()), jadi satu instance harus dibagikan lintas chunk.
 */
interface DbGlobal {
  /** Janji (bukan hasil) yang dibagikan: pemanggil paralel harus.await instance yang sama. */
  __novaDbPromise?: Promise<DbClient>;
  __novaDbRaw?: Raw;
  __novaDbMigration?: Promise<void>;
}

const shared = globalThis as unknown as DbGlobal;

let rawInstance: Raw | null = shared.__novaDbRaw ?? null;

async function createDriver(): Promise<{ client: Raw; describe: string }> {
  if (env.dataDriver === "postgres") {
    if (!env.databaseUrl) {
      throw new Error(
        "DATA_DRIVER=postgres membutuhkan DATABASE_URL. Untuk pengembangan lokal gunakan DATA_DRIVER=pglite.",
      );
    }
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({
      connectionString: env.databaseUrl,
      max: env.databasePoolMax,
      connectionTimeoutMillis: 10_000,
      ssl: env.databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    });
    return {
      client: {
        async query(sql, params = []) {
          const res = await pool.query(sql, params);
          return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
        },
        async exec(sql) {
          await pool.query(sql);
        },
        async transaction(fn) {
          const client = await pool.connect();
          try {
            await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
            const out = await fn({ query: (sql, params = []) => client.query(sql, params) });
            await client.query("COMMIT");
            return out;
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
        },
        async close() {
          await pool.end();
        },
      },
      describe: `postgres pool (max ${env.databasePoolMax})`,
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const dir = path.resolve(/* turbopackIgnore: true */ process.cwd(), env.pgliteDir);
  const client = await PGlite.create(dir);
  return {
    client: {
      async query(sql, params = []) {
        const res = await client.query(sql, params as never[]);
        const rows = (res as { rows?: unknown[] }).rows ?? [];
        return { rows, rowCount: rows.length };
      },
      async exec(sql) {
        await client.exec(sql);
      },
      async transaction<T>(
        fn: (tx: {
          query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
        }) => Promise<T>,
      ) {
        return client.transaction(async (tx) =>
          fn({
            query: async (sql, params = []) => {
              const res = await tx.query(sql, params as never[]);
              return { rows: (res as { rows?: unknown[] }).rows ?? [] };
            },
          }),
        );
      },
      async close() {
        await client.close();
      },
    },
    describe: `pglite ${dir}`,
  };
}

async function build(): Promise<DbClient> {
  const { client, describe } = await createDriver();
  rawInstance = client;
  shared.__novaDbRaw = client;
  log.info("db.connected", { driver: describe, embedded: env.isEmbeddedDatabase });
  // Penjaga re-entrancy: di dalam `db.transaction`, query WAJIB lewat `tx`. Memakai `db.query`
  // (connection lain/pool) melewati visibilitas & atomisitas - dan pada pglite (satu connection)
  // menggantung selamanya. Status disimpan per async-context (bukan global) agar transaksi
  // yang berjalan paralel tidak saling menandai.
  const assertNotInsideTx = (sql: string): void => {
    if (insideTx.getStore() === true) {
      throw new Error(
        `query() dipanggil di dalam transaksi yang sedang berjalan - gunakan tx.query() agar atomik. SQL: ${sql.slice(0, 90).replace(/\s+/g, " ")}`,
      );
    }
  };
  const db: DbClient = {
    query: async <T>(sql: string, params: unknown[] = []) => {
      assertNotInsideTx(sql);
      const r = await client.query(sql, params);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? r.rows.length };
    },
    exec: async (sql: string) => {
      assertNotInsideTx(sql);
      if (client.exec) await client.exec(sql);
      else await client.query(sql);
    },
    transaction: async <T>(fn: (tx: Tx) => Promise<T>) => {
      return (await client.transaction!((tx) =>
        insideTx.run(true, async () =>
          fn({
            query: <R>(sql: string, params: unknown[] = []) =>
              tx
                .query(sql, params)
                .then((r) => ({ rows: (r.rows ?? []) as R[], rowCount: (r.rows ?? []).length })),
          }),
        ),
      )) as T;
    },
  };
  return db;
}

export async function getDb(): Promise<DbClient> {
  const db = await getDbPromise();
  await ensureMigrated();
  return db;
}

/**
 * Pembuatan instance dilindungi SATU janji di globalThis. Membagi objek hasil saja tidak cukup:
 * beberapa chunk (SSR, tiap route handler, layout) bisa memanggil getDb() paralel sebelum build
 * pertama selesai, dan masing-masing akan membuka PGlite kedua di direktori yang sama - sumber
 * `RuntimeError: Aborted()` pada engine tertanam. Kegagalan tidak disimpan supaya percobaan
 * berikutnya boleh membangun ulang.
 */
export function getDbPromise(): Promise<DbClient> {
  if (!shared.__novaDbPromise) {
    shared.__novaDbPromise = build().catch((error: unknown) => {
      shared.__novaDbPromise = undefined;
      throw error;
    });
  }
  return shared.__novaDbPromise;
}

/**
 * Dev/QA convenience: migration dijalankan otomatis sekali per proses pada engine tertanam.
 * Untuk postgres, operator wajib menjalankan `npm run db:migrate` (Blueprint §18.2 - migration sadar).
 */
async function ensureMigrated(): Promise<void> {
  if (env.dataDriver !== "pglite") return;
  if (!shared.__novaDbMigration) {
    const run = (async () => {
      const { readdir, readFile } = await import("node:fs/promises");
      const dir = path.resolve(process.cwd(), "db/migrations");
      const names = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
      const db = await getDbPromise();
      await db.exec(
        `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), checksum text NOT NULL DEFAULT '')`,
      );
      const applied = new Set(
        (await db.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map(
          (r) => r.version,
        ),
      );
      for (const name of names) {
        const version = name.replace(/\.sql$/, "");
        if (applied.has(version)) continue;
        const sql = await readFile(path.join(dir, name), "utf8");
        await db.exec(sql);
        await db.query(
          "INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING",
          [version],
        );
        log.info("db.migrated", { version });
      }
    })().catch((error: unknown) => {
      shared.__novaDbMigration = undefined;
      throw error;
    });
    shared.__novaDbMigration = run;
  }
  await shared.__novaDbMigration;
}

/** Untuk test: tutup dan buang singleton (termasuk janji yang dibagi antar-chunk). */
export async function resetDbForTests(): Promise<void> {
  const pending = shared.__novaDbPromise;
  shared.__novaDbPromise = undefined;
  shared.__novaDbRaw = undefined;
  shared.__novaDbMigration = undefined;
  if (pending) await pending.catch(() => undefined);
  await rawInstance?.close?.();
  rawInstance = null;
}

/** true bila koneksi sudah pernah dibuka (dipakai halaman status integrasi). */
export function isDbConnected(): boolean {
  return shared.__novaDbRaw !== undefined && shared.__novaDbRaw !== null;
}

// --- Normalisasi nilai antar-driver (bigint bisa kembali sebagai string/BigInt, jsonb sebagai teks) ---

export function num(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "")
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function optNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = num(value);
  return Number.isFinite(n) ? n : null;
}

export function bool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "t" || value === "true" || value === "1";
  if (typeof value === "number") return value !== 0;
  return Boolean(value);
}

export function date(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function dateOrThrow(value: unknown, label = "tanggal"): Date {
  const d = date(value);
  if (!d) throw new Error(`Kolom ${label} kosong padahal wajib`);
  return d;
}

export function text(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

export function optText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.length === 0 ? null : s;
}

export function jsonb<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

export function strArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) return trimmed ? trimmed.split(",").map((s) => s.trim()) : [];
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((s) => s.replace(/^"|"$/g, "").trim())
      .filter(Boolean);
  }
  return [];
}

export function uuid(value: unknown): string {
  if (value === null || value === undefined) throw new Error("uuid tidak boleh kosong");
  return String(value);
}

export function optUuid(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Helper pembentuk daftar placeholder ($1, $2, ...) untuk IN (...) yang aman (parameterized). */
export function placeholders(
  values: readonly unknown[],
  startAt = 1,
): { sql: string; params: unknown[] } {
  return {
    sql: values.map((_, i) => `$${startAt + i}`).join(", "),
    params: [...values],
  };
}
