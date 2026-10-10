#!/usr/bin/env node
/**
 * Menghasilkan docs/schema-reference.md dari DB dev (pglite) agar skema yang
 * dipakai layer service bisa diperiksa tanpa membuka klien SQL.
 * Jalankan: node scripts/migrate.mjs && node scripts/schema-dump.mjs
 */
import { writeFileSync } from "node:fs";
import { openDb } from "./db-lib.mjs";

const db = await openDb({ pgliteDir: ".data/pglite" });
const cols = await db.query(
  `SELECT table_name, ordinal_position, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`,
);
const byTable = new Map();
for (const r of cols.rows) {
  if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
  byTable.get(r.table_name).push(r);
}
const idx = await db.query(
  `SELECT tablename, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename`,
);
const idxByTable = new Map();
for (const r of idx.rows) {
  if (!idxByTable.has(r.tablename)) idxByTable.set(r.tablename, []);
  idxByTable.get(r.tablename).push(r.indexdef.replace(/"/g, ""));
}
let out =
  "# Referensi Skema ndre.gstore\n\nDibangkitkan dari DB dev (semua migrasi diterapkan) oleh `scripts/schema-dump.mjs`.\nSumber kebenaran tetap `db/migrations/*.sql` — file ini untuk pembacaan cepat.\n\n";
for (const [t, list] of byTable) {
  out += `## \`${t}\`\n\n| kolom | tipe | null | default |\n|---|---|---|---|\n`;
  for (const c of list) {
    out += `| \`${c.column_name}\` | ${c.data_type} | ${c.is_nullable === "NO" ? "not null" : ""} | ${String(
      c.column_default ?? "",
    )
      .replace(/\|/g, "/")
      .slice(0, 70)} |\n`;
  }
  const ix = idxByTable.get(t) ?? [];
  if (ix.length)
    out += `\nIndeks/konstrain unik:\n\n` + ix.map((i) => `- \`${i}\``).join("\n") + "\n";
  out += "\n";
}
writeFileSync("docs/schema-reference.md", out);
console.log(`OK: ${byTable.size} tabel, ${cols.rows.length} kolom -> docs/schema-reference.md`);
await db.close();
