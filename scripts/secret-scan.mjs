#!/usr/bin/env node
/**
 * Pemindai secret di repository (Blueprint §13.1 & §18.1: kredensial tidak pernah masuk
 * source code / repository / log). Dipakai pra-commit atau CI.
 *
 * Deteksi: token provider yang dikenal, private key block, kredensial di URL koneksi,
 * assignment variabel sensitif dengan nilai literal, dan file .env yang ikut ter-commit.
 *
 * Jalankan: node scripts/secret-scan.mjs [--all]
 * Default memindai file tracked + untracked (menghormati .gitignore); `--all` juga memindai
 * file yang di-ignore - berguna untuk memastikan .env.local benar-benar tidak bocor.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const scanAll = process.argv.slice(2).includes("--all");

/** File yang boleh memuat contoh/placeholder non-rahasia. */
const ALLOW_FILES = new Set([
  ".env.example",
  "scripts/secret-scan.mjs",
  // Nilai test dummy (bukan kredensial nyata) untuk subprocess vitest.
  "vitest.setup.ts",
]);
/** Direktori yang dilewati. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".data",
  ".git",
  "coverage",
  "out",
  "build",
  "public",
]);
/** Ekstensi teks yang dipindai. */
const SCAN_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".sql",
  ".md",
  ".yml",
  ".yaml",
  ".html",
]);

const RULES = [
  {
    id: "private-key",
    why: "block private key",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  { id: "aws-key", why: "AWS access key id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "slack-token", why: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: "github-token", why: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { id: "openai-key", why: "OpenAI-style key", re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  {
    id: "url-credentials",
    why: "kredensial di URL koneksi",
    re: /\b(?:postgres(?:ql)?|mysql|redis|amqp):\/\/[^\s/]*:[^\s/]*@/g,
  },
  {
    id: "hardcoded-secret",
    why: "assignment secret dengan nilai literal",
    re: /\b(?:AUTH_SECRET|MOCK_WEBHOOK_SECRET|MIDTRANS_SERVER_KEY|XENDIT_SECRET_KEY|BITESHIP_API_KEY|SMTP_PASSWORD|SERVICE_ROLE_KEY|ANON_KEY|SECRET_KEY|API_KEY|ACCESS_TOKEN)\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/gi,
  },
  {
    id: "assigned-long-secret",
    why: "nilai panjang yang terlihat acak pada variabel sensitif",
    re: /\b(?:[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|WEBHOOK_KEY))[A-Z0-9_]*\s*[:=]\s*["'`][^"'`\s]{24,}["'`]/g,
  },
];

/** Placeholder sadar-contoh yang bukan bocoran kredensial. */
const ALLOW_VALUES = [
  "dev-only-insecure-secret-change-me",
  "change-me",
  "changeme",
  "your-",
  "example",
  "placeholder",
  "xxxxxx",
  "000000",
  "REPLACE",
  "dummy",
  "JBSWY3DPEHPK3PXP",
  "0000000000",
];

function gitLsFiles(args) {
  const res = spawnSync("git", ["-c", "core.quotePath=false", "ls-files", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    console.error("git ls-files gagal - jalankan skrip ini di dalam repository git.");
    process.exit(1);
  }
  return res.stdout.split("\n").filter(Boolean);
}

// Default = semua file yang "akan ikut ter-commit" (tracked + untracked tak-ignored), karena
// proyek ini masih dikerjakan sebelum commit pertama. `--all` menambahkan file yang di-ignore.
const candidates = scanAll
  ? gitLsFiles(["--cached", "--others", "--exclude-standard", "--ignored"])
  : gitLsFiles(["--cached", "--others", "--exclude-standard"]);

const files = candidates.filter((rel) => {
  const parts = rel.split("/");
  if (parts.some((p) => SKIP_DIRS.has(p))) return false;
  return SCAN_EXT.has(path.extname(rel));
});

const findings = [];
for (const rel of candidates) {
  if (/(^|\/)\.env(\.(local|production|development))?$/.test(rel) && !rel.endsWith(".example")) {
    findings.push({
      file: rel,
      rule: "env-committed",
      why: "file environment masuk ke git",
      line: 1,
      snippet: rel,
    });
  }
}

for (const rel of files) {
  if (ALLOW_FILES.has(rel)) continue;
  let content;
  try {
    content = await readFile(path.join(root, rel), "utf8");
  } catch {
    continue;
  }
  if (content.includes("\u0000")) continue;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > 1000) continue;
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      if (!rule.re.test(line)) continue;
      const low = line.toLowerCase();
      if (ALLOW_VALUES.some((v) => low.includes(v.toLowerCase()))) continue;
      findings.push({
        file: rel,
        rule: rule.id,
        why: rule.why,
        line: i + 1,
        snippet: line.trim().slice(0, 140),
      });
    }
  }
}

console.log(
  `secret-scan: ${files.length} file dipindai (${scanAll ? "seluruh tree incl. file yang di-ignore" : "tracked + untracked"}); temuan ${findings.length}`,
);
if (findings.length === 0) {
  console.log("OK: tidak ada indikasi kredensial/secret yang tertinggal di repository.");
  process.exit(0);
}
console.log(`\nDITEMUKAN ${findings.length} indikasi:`);
for (const f of findings) {
  console.log(`  [${f.rule}] ${f.file}:${f.line}  (${f.why})`);
  console.log(`      ${f.snippet}`);
}
console.log(
  "\nBlueprint §13.1: pindahkan nilai ke environment / .env.local (tidak dilacak git), lalu rotasi\n" +
    "kredensial yang terlanjur masuk riwayat commit. Bila temuan adalah placeholder sadar-contoh,\n" +
    "tambahkan kata 'example'/'placeholder' pada baris itu atau daftarkan file-nya di ALLOW_FILES.",
);
process.exit(1);
