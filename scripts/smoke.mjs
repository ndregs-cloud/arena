#!/usr/bin/env node
/**
 * Smoke test runtime (QA). Membutuhkan server yang sudah berjalan + DB terisi.
 *
 *   npm run build && npm run db:migrate && npm run db:seed
 *   NODE_ENV=production npx next start -H 0.0.0.0 -p 3000   # di terminal lain
 *   node scripts/smoke.mjs [base-url]
 *
 * Memeriksa hal yang TIDAK bisa dilihat oleh unit/integration test: bahwa halaman yang
 * bergantung DB benar-benar ter-render (bukan hanya shell loading), header keamanan terkirim,
 * halaman terlarus dijaga, dan webhook menolak signature palsu. Tidak mengubah data.
 */
const BASE = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);

let pass = 0;
let fail = 0;
const notes = [];

async function hit(pathname, { method = "GET", headers, body, redirect = "manual" } = {}) {
  const res = await fetch(`${BASE}${pathname}`, { method, headers, body, redirect });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, location: res.headers.get("location") };
}

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? `  -> ${detail}` : ""}`);
    notes.push(`${name}: ${detail}`);
  }
}

/** Halaman publik: status + potongan teks yang wajib ada. */
async function page(name, pathname, needles, { status = 200 } = {}) {
  let res;
  try {
    res = await hit(pathname);
  } catch (error) {
    check(name, false, `fetch gagal: ${error.message}`);
    return res;
  }
  const missing = needles.filter((n) => !res.text.includes(n));
  check(
    name,
    res.status === status && missing.length === 0,
    `status=${res.status}${missing.length ? ` hilang: ${missing.join(", ")}` : ""}`,
  );
  return res;
}

console.log(`smoke: ${BASE}`);

/** Teks terlihat saja: payload RSC di dalam <script> memang memakai tanda "$" internal. */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

// 1) Beranda + katalog --------------------------------------------------------
const home = await page("beranda merender produk", "/", ["NOVA STORE", "Rp"]);
const homeVisible = visibleText(home.text);
check(
  "harga memakai Rupiah, bukan pola USD di mockup",
  !/USD/.test(homeVisible) && !/\$\s?\d/.test(homeVisible) && /Rp[\s\u00a0]?\d/.test(homeVisible),
  `USD=${/USD/.test(homeVisible)} dollar=${/\$\s?\d/.test(homeVisible)} rupiah=${/Rp[\s\u00a0]?\d/.test(homeVisible)}`,
);
await page("listing/katalog", "/cari", ["Rp"]);
await page("detail produk (PDP)", "/produk/headphone-nirkabel-aureo-h2", [
  "Headphone Nirkabel Aureo H2",
  "Rp",
  "application/ld+json",
]);
await page(
  "PDP produk tidak dikenal -> 404",
  "/produk/tidak-ada-sekali-x9",
  ["Halaman tidak ditemukan"],
  {
    status: 404,
  },
);

// 2) Halaman yang dijaga ------------------------------------------------------
for (const [label, path] of [
  ["keranjang", "/keranjang"],
  ["checkout", "/checkout"],
  ["akun", "/akun"],
  ["admin", "/admin"],
  ["admin pesanan", "/admin/pesanan"],
]) {
  let res;
  try {
    res = await hit(path);
  } catch (error) {
    check(`${label}: merespons`, false, `fetch gagal: ${error.message}`);
    continue;
  }
  const redirected = [302, 303, 307].includes(res.status);
  check(
    `${label}: ter-render atau dialihkan ke login`,
    res.status === 200 || redirected,
    `status=${res.status} location=${res.location}`,
  );
  if (res.status === 200 && !res.text.includes("<form") && res.text.length < 2000) {
    check(`${label}: bukan sekadar shell loading`, false, `panjang HTML=${res.text.length}`);
  }
}
const guard = await hit("/admin/pesanan");
check(
  "admin tidak melayani data ke pengunjung anonim",
  [302, 303, 307].includes(guard.status) ||
    (!/order_number|Total pesanan/i.test(guard.text) && guard.status < 500),
  `status=${guard.status}`,
);

// 3) CSRF + webhook -----------------------------------------------------------
const hook = await hit("/api/webhooks/payments/mock", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ event: "payment.settlement", externalRef: "SMOKE-FAKE-1" }),
});
check(
  "webhook tanpa signature ditolak 401",
  hook.status === 401,
  `status=${hook.status} body=${hook.text.slice(0, 120)}`,
);
const hookGet = await hit("/api/webhooks/payments/mock");
check("webhook menolak method GET (405)", hookGet.status === 405, `status=${hookGet.status}`);
const unknownProvider = await hit("/api/webhooks/payments/bukan-provider", {
  method: "POST",
  body: "{}",
});
check(
  "provider tidak dikenal -> 404",
  unknownProvider.status === 404,
  `status=${unknownProvider.status}`,
);

// 4) Header keamanan (Blueprint §13.1) ----------------------------------------
const csp = home.headers.get("content-security-policy") ?? "";
for (const [label, ok] of [
  ["X-Content-Type-Options: nosniff", home.headers.get("x-content-type-options") === "nosniff"],
  [
    "Referrer-Policy",
    /strict-origin-when-cross-origin/.test(home.headers.get("referrer-policy") ?? ""),
  ],
  ["CSP default-src 'self'", /default-src 'self'/.test(csp)],
  ["CSP object-src 'none'", /object-src 'none'/.test(csp)],
  ["CSP frame-ancestors di-set", /frame-ancestors /.test(csp)],
  ["X-Powered-By disembunyikan", home.headers.get("x-powered-by") === null],
]) {
  check(`header: ${label}`, ok, ok ? "" : `csp=${csp.slice(0, 60)}`);
}

// 5) SEO & metadata ------------------------------------------------------------
await page("sitemap.xml", "/sitemap.xml", ["<urlset", "/produk/"]);
await page("robots.txt", "/robots.txt", ["Sitemap"]);
await page("halaman kebijakan", "/kebijakan/pengiriman", ["pengiriman"]);
await page("syarat & ketentuan", "/syarat", ["Syarat"]);
const tracking = await hit("/lacak-pesanan/token-palsu-singkat");
check(
  "lacak tanpa token valid: ditolak dengan sopan (200/404, tanpa stack trace)",
  [200, 404].includes(tracking.status) && !/at .*\.ts:\d+/.test(tracking.text),
  `status=${tracking.status}`,
);

// 6) Tidak ada secret yang bocor ke klien --------------------------------------
check(
  "tidak ada string rahasia di HTML publik",
  !/AUTH_SECRET|MOCK_WEBHOOK_SECRET|DATABASE_URL/.test(home.text),
  "nama variabel rahasia muncul di HTML",
);

console.log(`\nsmoke: ${pass} OK, ${fail} GAGAL`);
if (fail > 0) {
  console.log("\nButir gagal:");
  for (const n of notes) console.log(`  - ${n}`);
  process.exit(1);
}
