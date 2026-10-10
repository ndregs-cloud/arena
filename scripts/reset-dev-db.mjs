#!/usr/bin/env node
/**
 * Reset database DEV lokal: hapus .data/pglite lalu migrate + seed ulang.
 *
 * AMAN HANYA UNTUK DEV: skrip ini menolak jalan kalau DATA_DRIVER=postgres atau
 * NODE_ENV=production (Blueprint §18.2 - tidak ada "destructive convenience" di staging/produksi).
 *
 * Jalankan: node scripts/reset-dev-db.mjs [--no-seed]
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadEnv } from "./db-lib.mjs";

const args = process.argv.slice(2);
const withSeed = !args.includes("--no-seed");

const env = { ...(await loadEnv()), ...process.env };
const root = process.cwd();

if (env.DATA_DRIVER === "postgres") {
  console.error(
    "DITOLAK: DATA_DRIVER=postgres. Untuk DB nyata gunakan `npm run db:migrate` + migration turunahan,\n" +
      "jangan menjalankan skrip reset (DROP data) dari CLI.",
  );
  process.exit(1);
}
if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
  console.error("DITOLAK: skrip ini hanya untuk development.");
  process.exit(1);
}

const dir = env.PGLITE_DIR || ".data/pglite";
const target = path.resolve(root, dir);
if (!target.startsWith(path.join(root, ".data"))) {
  console.error(
    `DITOLAK: PGLITE_DIR (${dir}) harus berada di bawah .data/ supaya rm -rf tidak berbahaya.`,
  );
  process.exit(1);
}

console.log(`Menghapus ${path.relative(root, target)} ...`);
const removed = await rm(target, { recursive: true, force: true });
console.log(removed === undefined ? "  direktori data dibersihkan." : "");

const run = (script, extra = []) => {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", script), ...extra], {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, ...env },
  });
  if (res.status !== 0) {
    console.error(`${script} gagal (exit ${res.status}).`);
    process.exit(res.status ?? 1);
  }
};

run("migrate.mjs");
if (withSeed) {
  console.log("\nMengisi data dev ...");
  run("seed.mjs");
} else {
  console.log("Seed dilewati (--no-seed).");
}
console.log("\nReset selesai. Database dev siap dipakai.");
