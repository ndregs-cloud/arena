import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

export async function loadEnv() {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) return {};
  const out = {};
  const lines = (await readFile(file, "utf8")).split("\n");
  for (const line of lines) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return out;
}

export async function readMigrations(dir = MIGRATIONS_DIR) {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      version: name.replace(/\.sql$/, ""),
      sql: await readFile(path.join(dir, name), "utf8"),
    })),
  );
}

export async function openDb({ driver, databaseUrl, pgliteDir, memory } = {}) {
  const chosen = driver || "pglite";
  if (chosen === "postgres") {
    if (!databaseUrl)
      throw new Error(
        "DATA_DRIVER=postgres membutuhkan DATABASE_URL (Blueprint §18.1: secret dari environment).",
      );
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    });
    return {
      driver: "postgres",
      async query(sql, params = []) {
        const res = await pool.query(sql, params);
        return { rows: res.rows, rowCount: res.rowCount };
      },
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn(wrapTx(client));
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
      async exec(sql) {
        await pool.query(sql);
      },
      async close() {
        await pool.end();
      },
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const target = memory ? undefined : pgliteDir ? path.resolve(ROOT, pgliteDir) : undefined;
  if (target) await mkdir(path.dirname(target), { recursive: true });
  const client = target ? await PGlite.create(target) : await PGlite.create();
  return {
    driver: "pglite",
    target: target ?? ":memory:",
    async query(sql, params = []) {
      const res = await client.query(sql, params);
      return { rows: res.rows ?? [], rowCount: res.rows?.length ?? 0 };
    },
    async transaction(fn) {
      return client.transaction(async (tx) => fn(wrapTx(tx)));
    },
    async exec(sql) {
      await client.exec(sql);
    },
    async close() {
      await client.close();
    },
  };
}

function wrapTx(client) {
  return {
    query: (sql, params = []) =>
      client
        .query(sql, params)
        .then((r) => ({ rows: r.rows ?? [], rowCount: r.rowCount ?? r.rows?.length ?? 0 })),
    // Simple query protocol: diperlukan untuk beberapa statement dalam satu migration.
    exec: async (sql) => {
      if (typeof client.exec === "function") await client.exec(sql);
      else await client.query(sql);
    },
  };
}

export async function migrate(db, { log = console.log } = {}) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), checksum text NOT NULL
  )`);
  const applied = new Set(
    (await db.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version),
  );
  const migrations = await readMigrations();
  let count = 0;
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    const { createHash } = await import("node:crypto");
    const checksum = createHash("sha256").update(m.sql).digest("hex").slice(0, 16);
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query("INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)", [
        m.version,
        checksum,
      ]);
    });
    log(`  ✓ ${m.version}`);
    count += 1;
  }
  if (count === 0) log("  (semua migration sudah diterapkan)");
  return count;
}

export async function writeIfChanged(file, content) {
  if (existsSync(file) && (await readFile(file, "utf8")) === content) return false;
  await writeFile(file, content, "utf8");
  return true;
}
