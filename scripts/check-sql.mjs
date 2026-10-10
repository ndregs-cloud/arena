#!/usr/bin/env node
/**
 * Validasi statis SQL dalam kode terhadap skema DB aktual:
 * - tabel/kolom harus ada;
 * - kolom GENERATED (mis. available, total_computed, line_total_amount) tidak boleh di-INSERT/UPDATE;
 * - CHECK enum sederhana untuk kolom `presentation` dll. (lewat daftar nilai di komentar tidak dilakukan).
 * Jalankan: node scripts/check-sql.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "./db-lib.mjs";

const db = await openDb({ pgliteDir: process.env.PGLITE_DIR || ".data/pglite" });
const cols = await db.query(
  `SELECT c.table_name, c.column_name,
          (SELECT count(*) FROM information_schema.columns g WHERE g.table_name=c.table_name AND g.column_name=c.column_name AND g.is_generated='ALWAYS') AS generated
     FROM information_schema.columns c WHERE c.table_schema='public'`,
);
const schema = new Map();
for (const row of cols.rows) {
  if (!schema.has(row.table_name))
    schema.set(row.table_name, { columns: new Set(), generated: new Set() });
  const entry = schema.get(row.table_name);
  entry.columns.add(row.column_name);
  if (Number(row.generated) > 0) entry.generated.add(row.column_name);
}
await db.close();

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(path)) out.push(path);
  }
  return out;
}

const problems = [];
for (const file of files("src").concat(files("scripts"))) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gs)) {
    const table = match[1];
    const entry = schema.get(table);
    if (!entry) {
      problems.push(`${file}: tabel tidak dikenal: ${table}`);
      continue;
    }
    for (const raw of match[2].split(",")) {
      const column = raw.trim().replace(/--.*/, "");
      if (!column || column.startsWith("--")) continue;
      if (!entry.columns.has(column))
        problems.push(`${file}: ${table}.${column} bukan kolom (INSERT)`);
      else if (entry.generated.has(column))
        problems.push(`${file}: ${table}.${column} adalah kolom GENERATED - tidak boleh di-INSERT`);
    }
  }
  for (const match of source.matchAll(
    /UPDATE\s+([a-z_][a-z0-9_]*)\s+SET\s+([\s\S]*?)(?:\s+WHERE|\s+RETURNING|$)/g,
  )) {
    const table = match[1];
    const entry = schema.get(table);
    if (!entry) {
      problems.push(`${file}: tabel tidak dikenal (UPDATE): ${table}`);
      continue;
    }
    for (const column of match[2].matchAll(/([a-z_][a-z0-9_]*)\s*=/g)) {
      const name = column[1];
      if (!entry.columns.has(name))
        problems.push(`${file}: ${table}.${name} bukan kolom (UPDATE SET)`);
      else if (entry.generated.has(name))
        problems.push(`${file}: ${table}.${name} adalah kolom GENERATED - tidak boleh di-UPDATE`);
    }
  }
}
const unique = [...new Set(problems)];
if (unique.length === 0)
  console.log(
    `check-sql OK: tidak ada kolom/tabel tak dikenal di ${files("src").length + files("scripts").length} berkas.`,
  );
else {
  console.log(`check-sql: ${unique.length} masalah`);
  for (const problem of unique) console.log(` - ${problem}`);
  process.exitCode = 1;
}
