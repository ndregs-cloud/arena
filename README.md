# ndre.gstore — storefront B2C + Admin center

Implementasi awal _Blueprint E-Commerce Enterprise v1.0_ dan _Spesifikasi UI/UX v1.0_ untuk
toko tunggal (single-merchant) di Indonesia. Brand antarmuka masih placeholder **NOVA STORE**
sesuai dokumen desain §20.1.

> **Status: kerangka fungsional di lingkungan demo — BUKAN production-ready.**
> Seluruh alur bisnis berjalan di atas **adapter simulasi** (pembayaran, pengiriman, email) dan
> database Postgres tertanam. Bagian yang memerlukan kredensial/keputusan bisnis dicatat di
> [§7 Integrasi yang menunggu kredensial](#7-integrasi-yang-menunggu-kredensial) dan
> [§8 Prasyarat sebelum produksi](#8-prasyarat-sebelum-produksi). Jangan memublikasikan aplikasi
> ini sebelum daftar itu selesai dan diverifikasi orang lain.

---

## 1. Mulai cepat

Prasyarat: **Node ≥ 20.11** (diverifikasi pada Node 22.22) dan npm ≥ 10. Tidak perlu Docker,
tidak perlu server PostgreSQL, tidak perlu akun provider apa pun.

```bash
npm install            # ±457 paket
npm run db:reset       # buat DB dev (.data/pglite) + migration + seed data contoh
npm run dev            # http://localhost:3000
```

Build dan jalankan seperti produksi:

```bash
npm run build
NODE_ENV=production AUTH_SECRET="$(openssl rand -base64 48)" \
MOCK_WEBHOOK_SECRET="example-lokal-ganti-saya" npm run start
node scripts/smoke.mjs           # 26 pemeriksaan runtime
```

`AUTH_SECRET` wajib ≥ 32 byte saat `NODE_ENV=production`; aplikasi menolak boot tanpa itu.
Kedua nilai di atas cukup untuk uji lokal — jangan dipakai di lingkungan yang bisa diakses orang lain.

## 2. Akun demo (hanya dev/test)

Seed mencetak kata sandi **sekali** saat dijalankan. Bila `SEED_DEV_PASSWORD` tidak diisi,
nilainya acak. Untuk menyamakan dengan dokumentasi:

```bash
SEED_DEV_PASSWORD='DemoOnly-2026-dev' node scripts/seed.mjs --force
```

| Email                        | Peran                | Area yang bisa dibuka                          |
| ---------------------------- | -------------------- | ---------------------------------------------- |
| `admin@ndre.gstore.test`     | `system_admin`       | seluruh admin, pengaturan, pengguna & role     |
| `katalog@ndre.gstore.test`   | `catalog_editor`     | katalog, varian, media, harga                  |
| `operator@ndre.gstore.test`  | `order_operator`     | transisi order, pengiriman, tracking           |
| `cs@ndre.gstore.test`        | `customer_support`   | data pelanggan, retur (tanpa approve)          |
| `gudang@ndre.gstore.test`    | `warehouse_operator` | permintaan penyesuaian stok                    |
| `keuangan@ndre.gstore.test`  | `finance`            | rekonsiliasi, approve refund (bersama manager) |
| `manager@ndre.gstore.test`   | `manager`            | approve refund/retur, laporan, audit           |
| `audit@ndre.gstore.test`     | `auditor`            | audit log (baca saja)                          |
| `pelanggan@ndre.gstore.test` | `customer`           | storefront + halaman akun                      |

Akun staf **wajib MFA** (`REQUIRE_MFA_FOR_STAFF=true`). Seed memakai secret TOTP dev tetap
sehingga kodenya bisa dicetak:

```bash
node scripts/dev-totp.mjs          # -> kode 6 angka, berlaku ≤30 detik
```

Untuk uji cepat tanpa MFA: `REQUIRE_MFA_FOR_STAFF=false npm run dev`.

Katalog contoh: 12 produk (10 terbit, 1 pratinjau, 1 arsip), 23 varian, 9 kategori, 5 order
contoh, kupon `HERO10`, `ONGKIRGRATIS`, `EXPIRED20`, `APPROVE25`. Semua order/resi/refund yang
Anda lihat adalah **contoh** — bukan transaksi nyata.

## 3. Perintah

| Perintah                                  | Fungsi                                                            |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `npm run dev`                             | Next.js dev server                                                |
| `npm run build` / `npm run start`         | Build produksi / jalankan hasil build                             |
| `npm test`                                | 105 pengujian (54 unit + 31 integration + 20 komponen)            |
| `npm run test:unit`                       | Aturan domain murni                                               |
| `npm run test:integration`                | Skema + service di Postgres nyata (pglite)                        |
| `npm run test:components`                 | Render, state, aksesibilitas (axe-core)                           |
| `npm run lint` / `npm run lint:fix`       | ESLint                                                            |
| `npm run format` / `npm run format:check` | Prettier                                                          |
| `npm run typecheck`                       | `tsc --noEmit`                                                    |
| `npm run db:migrate`                      | Terapkan migration yang belum jalan                               |
| `npm run db:seed`                         | Isi data dev (`-- --force` untuk kosongkan dulu)                  |
| `npm run db:reset`                        | Hapus DB dev lalu migrate + seed (menolak `DATA_DRIVER=postgres`) |
| `npm run jobs:outbox`                     | Satu siklus worker notifikasi + antrian integrasi                 |
| `npm run audit:secrets`                   | Pemindai kredensial yang tertinggal di repository                 |
| `npm run smoke`                           | Smoke test runtime terhadap server yang sedang berjalan           |

Dua pemeriksa tambahan (dipakai lokal/CI):

```bash
node scripts/check-sql.mjs      # semua SQL di repo hanya menyentuh tabel/kolom yang ada
node scripts/schema-dump.mjs    # regenerasi docs/schema-reference.md dari DB
```

## 4. Arsitektur

```
src/
  app/            # App Router: halaman, layout, server actions, route handler
  components/     # ui/ (primitif) + commerce/ + account/ + admin/
  domain/         # aturan bisnis MURNI (tanpa Next, tanpa DB) - 13 berkas
  server/         # konteks request + services (14) - satu-satunya lapis yang menyentuh DB
  platform/       # env, db, auth, audit, notifications, password, totp, payment/, shipping/
  lib/            # format (IDR/tanggal id-ID), cn, brand, form-state
db/migrations/    # 9 migration SQL - satu-satunya sumber skema
scripts/          # migrate, seed, worker outbox, pemeriksa, smoke
tests/            # unit / integration / components
docs/             # schema-reference.md (dibangkitkan), design-tokens.md
```

Prinsip yang ditegakkan:

- **Domain murni.** Pembulatan rupiah, alokasi diskon, kelayakan retur, mesin status order, RBAC,
  dan validasi stok diuji tanpa DB (`src/domain/*`). UI tidak pernah menghitung harga final.
- **Otorisasi di server.** Default-deny; 34 permission, 10 peran. UI boleh menyembunyikan tombol,
  keputusan tetap di `requirePermission()` dalam service (`src/domain/rbac.ts`).
- **Satu konteks request.** `getRequestContext()` (`src/server/context.ts`) memuat sesi,
  permission, dan token keranjang; service hanya percaya objek ini, bukan cookie. Guard halaman
  `requireStaffPage()` / `requireCustomerPage()` redirect sebelum data apa pun dibaca.
- **Harga & stok dihitung ulang di server** pada setiap aksi; angka dari klien tidak dipercaya.
- **Status pembayaran hanya dari provider** (atau adapter simulasi), tidak dari UI.
- **Audit & outbox.** Tindakan staf dicatat di `audit_logs`; notifikasi dan antrian integrasi
  lewat `notification_outbox` / `integration_outbox` dengan retry + backoff eksponensial.

### 4.1 Lapisan data

Satu set SQL untuk dua driver (`src/platform/db.ts`):

- `DATA_DRIVER=pglite` (default dev/test) — Postgres nyata tertanam di `.data/pglite`. **Bukan**
  untuk produksi, dan hanya boleh dibuka **satu proses** pada satu waktu.
- `DATA_DRIVER=postgres` + `DATABASE_URL` — PostgreSQL/Supabase-managed untuk staging & produksi.
  Pakai koneksi transaction-mode (PgBouncer) dan pertimbangkan RLS.

Skema 55 tabel, antara lain `inventory_balances.available` (generated:
`on_hand - reserved - safety_stock`), `orders.total_computed` (generated), constraint
`reserved <= on_hand`, CHECK transisi status, dan trigger yang menolak `shipped`/`delivered`
saat `payment_status <> 'succeeded'`. Referensi kolom lengkap:
[`docs/schema-reference.md`](docs/schema-reference.md) — baca sebelum menulis SQL baru.

### 4.2 Pembayaran & pengiriman

`src/platform/payment/` dan `src/platform/shipping/` memakai pola adapter + registry. Default
`PAYMENT_PROVIDER=mock` dan `SHIPPING_PROVIDER=mock`:

- **Pembayaran simulasi** — VA/QRIS/kartu dengan skenario yang bisa dipilih (`success`,
  `pending`, `failed`, `expired`, `duplicate`, `out_of_order`) lewat `/simulasi-pembayaran/[attemptId]`,
  callback ke `/kembali-pembayaran/[attemptId]`, dan inbound ke
  `POST /api/webhooks/payments/[provider]` dengan **HMAC atas raw body** (`MOCK_WEBHOOK_SECRET`),
  deduplikasi event, serta jalur `needs_review` untuk anomali. Nomor VA selalu berprefix
  `SIMULASI-` supaya tidak pernah mirip rekening nyata.
- **Ongkir simulasi** — tarif dari `SHIPPING_SERVICES` (reguler/yes/kgo + tambahan per kg) dengan
  kutipan berkedaluwarsa; kutipan basi ditolak `409 SHIPPING_QUOTE_EXPIRED`.

Adapter bisa diganti implementasi provider nyata tanpa menyentuh service/domain.

## 5. Konfigurasi

Salin `.env.example` → `.env.local` (tidak masuk git). Berkas contoh itu berisi **nama variabel +
default non-rahasia**, bukan kredensial. Yang wajib sebelum lingkungan bersama:

| Variabel                                | Kenapa wajib                                                        |
| --------------------------------------- | ------------------------------------------------------------------- |
| `AUTH_SECRET`                           | tanda tangan cookie sesi; ≥ 32 byte acak; rotasi = semua sesi putus |
| `MOCK_WEBHOOK_SECRET`                   | verifikasi signature webhook (hapus saat memakai provider nyata)    |
| `DATABASE_URL` + `DATA_DRIVER=postgres` | data nyata tidak boleh di pglite                                    |
| `NEXT_PUBLIC_APP_URL`                   | URL kanonik, sitemap, tautan di email                               |
| `REQUIRE_MFA_FOR_STAFF=true`            | jangan pernah dimatikan di staging/produksi                         |
| `NOTIFY_SINK`                           | `log` = tidak ada email nyata; `smtp` butuh transport + kredensial  |

## 6. Kualitas: perintah yang benar-benar dijalankan

Hasil pada lingkungan ini (Node 22.22, basis `main` commit `4f52019`):

| Perintah                     | Hasil                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| `npm install`                | OK — 457 paket                                                   |
| `npm run db:migrate`         | OK — 9 migration diterapkan                                      |
| `npm run db:seed`            | OK — 12 produk, 23 varian, 5 order contoh, 10 akun               |
| `npm test`                   | **105 lulus** (54 unit, 31 integration, 20 komponen)             |
| `npm run typecheck`          | bersih                                                           |
| `npm run lint`               | bersih — 0 error, 0 warning                                      |
| `npm run format:check`       | bersih                                                           |
| `node scripts/check-sql.mjs` | OK — 158 berkas SQL diperiksa terhadap skema                     |
| `npm run audit:secrets`      | OK — 0 indikasi kredensial di repository                         |
| `npm run build`              | OK — 49 rute; semua dinamis kecuali `robots.txt` & `sitemap.xml` |
| `npm run smoke`              | **26/26 OK** terhadap `next start` (produksi)                    |

Cakupan uji: aturan harga/kupon/retur/RBAC (unit); migration + constraint + transaksi stok,
checkout idempoten, balapan stok 14 permintaan paralel, deduplikasi webhook, IDOR token lacak,
maker–checker refund, alokasi diskon proporsional (integration); primitif UI + axe-core + format
IDR (components). Smoke runtime memeriksa halaman ber-DB benar-benar ter-render, header keamanan
terkirim, 404 sungguhan, webhook tanpa signature ditolak 401, dan tidak ada rahasia di HTML.

Yang **belum** diuji: beban & Core Web Vitals terukur, E2E browser nyata (Playwright), penerimaan
provider nyata, backup/restore, dan uji penetrasi.

## 7. Integrasi yang menunggu kredensial

Tidak ada satu pun panggilan keluar yang diimplementasikan — disengaja, supaya tidak ada
transaksi, nomor rekening, atau status pengiriman fiktif yang menyerupai nyata.

| Integrasi                            | Status sekarang           | Untuk aktif butuh                                                                        |
| ------------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------- |
| Payment gateway (Midtrans/Xendit)    | adapter mock              | kontrak + `SERVER_KEY`/`SECRET_KEY`, token webhook, sandbox → produksi, uji rekonsiliasi |
| QRIS (BI)                            | belum                     | keputusan lisensi/penyelenggara [R6][R12]                                                |
| Kartu (PCI DSS)                      | hanya simulasi            | keputusan scope PCI, hosted fields [R5]                                                  |
| Kurir nyata (tarif, label, tracking) | tarif & tracking simulasi | API key, verifikasi produk/area layanan, webhook tracking                                |
| Email/SMS transaksi                  | `NOTIFY_SINK=log`         | provider SMTP/WhatsApp, SPF/DKIM/DMARC, template disetujui                               |
| Faktur pajak (e-Faktur)              | belum                     | keputusan fiskal + integrasi DJP/penyedia                                                |
| ERP/akuntansi dua arah               | outbox satu arah          | kontrak data + kredensial                                                                |
| Sentry/observability                 | `SENTRY_DSN` kosong       | project, sampling, dashboard SLO [R7]                                                    |
| Moderasi ulasan, kampanye CMS        | data contoh               | kebijakan moderasi + editor konten                                                       |

## 8. Prasyarat sebelum produksi

Diperlukan sebelum istilah "production-ready" boleh dipakai (Blueprint §18–§19):

1. **Identitas & kepatuhan**: merek final, badan usaha/NPWP, kebijakan retur & privasi yang
   dibaca legal, pendaftaran PSE [R4], pemenuhan UU PDP [R3], PP 80/2019 [R1], Permendag 19/2026 [R2].
2. **Data**: PostgreSQL/Supabase + `DATABASE_URL`, migration lewat pipeline, backup terjadwal +
   **uji restore**, retensi log & audit, PgBouncer transaction mode.
3. **Secrets**: di secret manager (bukan `.env` di server), `AUTH_SECRET` terrotasi,
   `MOCK_WEBHOOK_SECRET` dihapus, `REQUIRE_MFA_FOR_STAFF=true`, CSP `frame-ancestors 'none'`
   (variasi `FRAME_ANCESTORS` hanya untuk pratinjau lokal/CI).
4. **Provider**: uji sandbox → transaksi nyata (berhasil, gagal, pending, refund sebagian),
   verifikasi signature + retry + idempotensi, lalu rekonsiliasi harian.
5. **Operasional**: rate limiting di edge/WAF, pantau 5xx & kedalaman antrian outbox, SLO,
   runbook insiden (mencabut sesi massal, menutup katalog, menghentikan checkout), log tanpa
   data pribadi.
6. **Kualitas**: E2E untuk 5 alur inti, Lighthouse/CWV di perangkat nyata [R7], audit WCAG 2.2
   AA [R9], uji penetrasi/ASVS [R10][R11].
7. **Keputusan bisnis**: COD, ambang refund otomatis, PPN/service fee, area pengiriman, SLA
   retur, proses restocking — saat ini memakai angka default dokumen.

Selama butir 1–6 belum selesai dan diverifikasi orang lain, status aplikasi ini **demo /
pra-produksi**: layak untuk evaluasi internal, belum untuk melayani pelanggan nyata.

## 9. Keputusan penting yang perlu diketahui

- Harga diformat **Rupiah penuh** (`formatIDR`, tanpa desimal); angka USD di mockup hanya contoh
  dan tidak pernah dipakai sebagai mata uang produksi.
- Uang disimpan sebagai `integer` + `currency char(3) = 'IDR'`; tidak ada `decimal`/`float` untuk
  uang sehingga tidak ada galat pembulatan biner.
- Order dibuat sebelum pembayaran, dengan **reservasi stok ber-TTL**
  (`STOCK_RESERVATION_TTL_MINUTES`) yang dilepas saat kedaluwarsa; status lunas hanya dari webhook.
- Kunci idempoten per keranjang menolak order ganda akibat klik dua kali (AT-02).
- Refund di atas `REFUND_AUTO_APPROVE_LIMIT` wajib approver berbeda (maker–checker); constraint DB
  menolak `approved_by = requested_by`.
- Token lacak ≥ 20 karakter dan membuka **hanya** order miliknya; tidak ada data pribadi lain di
  halaman anonim (AT-07).
- Sesi diverifikasi ke DB pada tiap request, sehingga "cabut semua sesi"/reset kata sandi
  berlaku seketika — bukan setelah TTL lewat.
- 404 adalah 404 sungguhan: `loading.tsx` sengaja tidak dipasang di segmen yang bisa
  `notFound()`/`redirect()` agar status HTTP tidak berubah menjadi soft-200.

## 10. Berkas non-kode

- `db/migrations/*.sql` — satu-satunya sumber skema; jangan edit migration yang sudah diterapkan,
  tambahkan yang baru.
- `docs/schema-reference.md` — dibangkitkan dengan `node scripts/schema-dump.mjs`.
- `docs/design-tokens.md` — token warna/tipografi/ritme, tata letak per area, dan larangan visual.
- `public/img/**` — SVG yang dibuat untuk demo (bukan foto produk nyata).
- `.data/` — DB dev/test, di-gitignore.
