# Design tokens & aturan visual

Sumber kebenaran teknis: blok `@theme` di `src/app/globals.css` (Tailwind v4, tanpa
`tailwind.config.js`). Nilai di bawah adalah hasil baca berkas tersebut + aturan yang
dipakai komponen. Bila token berubah, perbarui berkas ini.

Acuan: `design_e_commercial_nya.pdf` (§2, §4, §6–§14) dan `Blueprint_Ecommerce_Enterprise.pdf`
§12. Kebutuhan numerik tidak pernah "dipinjam" dari mockup (mis. harga USD) — lihat §6.

## 1. Warna

| Token                 | Nilai     | Kelas utilitas                           | Dipakai untuk                                  |
| --------------------- | --------- | ---------------------------------------- | ---------------------------------------------- |
| `--color-brand`       | `#315CFF` | `text-brand`, `bg-brand`, `border-brand` | Aksi utama, tautan aktif, fokus, tombol primer |
| `--color-brand-hover` | `#2446CF` | `hover:bg-brand-hover`                   | Hover/active tombol primer                     |
| `--color-brand-soft`  | `#EAEFFF` | `bg-brand-soft`                          | Chip filter aktif, latar info brand            |
| `--color-ink`         | `#172033` | `text-ink`                               | Teks utama, heading                            |
| `--color-ink-soft`    | `#3D4A63` | `text-ink-soft`                          | Teks sekunder di atas permukaan                |
| `--color-secondary`   | `#667085` | `text-secondary`                         | Label, metadata, teks bantu                    |
| `--color-canvas`      | `#F5F7FB` | `bg-canvas`                              | Latar halaman                                  |
| `--color-surface`     | `#FFFFFF` | `bg-surface`                             | Kartu, sheet, header                           |
| `--color-border`      | `#E3E8F0` | `border-border`                          | Garis pemisah, border kontrol                  |
| `--color-success`     | `#15803D` | `text-success`, `bg-success-soft`        | Status berhasil: pembayaran, terkirim          |
| `--color-warning`     | `#B7791F` | `text-warning`, `bg-warning-soft`        | Menunggu: bayar, tinjau, stok menipis          |
| `--color-danger`      | `#C2413A` | `text-danger`, `bg-danger-soft`          | Gagal, ditolak, error formulir                 |
| `--color-info`        | `#1F6F8B` | `text-info`, `bg-info-soft`              | Catatan netral, alert info                     |

Setiap nada punya pasangan `*-soft` untuk latar, sehingga kontras teks tetap ≥ 4.5:1 pada
teks 14 px. Status **tidak pernah** dikomunikasikan dengan warna saja: `StatusChip`
menempelkan titik + label teks (`src/components/ui/badge.tsx`).

## 2. Radius, bayangan, tipografi

| Token              | Nilai                                                         | Catatan                         |
| ------------------ | ------------------------------------------------------------- | ------------------------------- |
| `--radius-control` | `10px`                                                        | tombol, input, select           |
| `--radius-card`    | `14px`                                                        | kartu, panel, modal             |
| `--radius-tile`    | `6px`                                                         | thumbnail, badge kecil          |
| `--radius-sheet`   | `20px`                                                        | bottom sheet di mobile          |
| `--radius-pill`    | `999px`                                                       | chip filter, badge              |
| `--shadow-card`    | `0 1px 2px rgba(23,32,51,.06), 0 8px 24px rgba(23,32,51,.06)` | kartu di atas kanvas            |
| `--shadow-pop`     | `0 12px 32px rgba(23,32,51,.16)`                              | popover/dropdown                |
| `--font-sans`      | `ui-sans-serif, system-ui, …`                                 | tanpa unduhan font (hemat LCP)  |
| `--text-body`      | `16px / 24px`                                                 | ukuran standar input & paragraf |
| `--text-caption`   | `12px / 16px`                                                 | label metadata                  |

`Tabular numerals` dipakai untuk harga, nomor pesanan, danresi melalui kelas `tnum`
(`font-variant-numeric: tabular-nums`) supaya kolom tidak bergeser.

## 3. Ritme, kontrol, dan aksesibilitas

- Kontrol interaktif **≥ 44 × 44 px** (`min-h-[44px]` di `Button`, `Input`, `Select`, tab).
- Cincin fokus: `outline: 3px solid color-mix(brand 55%)` dengan `outline-offset: 2px`
  (lihat `.focus-ring` di `globals.css`). Jangan menghapusnya di komponen turunan.
- Link "Lompat ke konten utama" ada di `src/app/layout.tsx` dengan `#konten-utama`.
- Titik putus: `xs 375`, `sm 600`, `md 900`, `lg 1280`; kontainer maksimum `1280px`.
- Gerakan: 100–240 ms; seluruh animasi dimatikan pada `prefers-reduced-motion: reduce`.
- Gambar produk memakai `loading="lazy"` kecuali media pertama PDP; rasio kartu 1:1, PDP 4:3.

## 4. Tata letak per area (dari dokumen desain)

| Area     | Aturan                                                                                   |
| -------- | ---------------------------------------------------------------------------------------- |
| Header   | tinggi 56 px (mobile) / 72 px (≥900 px), sticky, search selalu terlihat di mobile        |
| PDP      | media 55–58 % lebar pada ≥900 px; kolom beli di kanan; varian sebagai segmented chips    |
| Listing  | sidebar filter 264 px, grid 2/3/4 kolom pada xs/md/lg; toolbar sort + jumlah hasil       |
| Checkout | form 60–64 %, ringkasan order sticky 360 px di kanan; 4 langkah bernomor                 |
| Admin    | sidebar 248 px ( collapsible di <900 px), tabel dengan header sticky                     |
| Mobile   | drawer keranjang/checkout full-screen dengan `--radius-sheet`; CTA beli lengket di bawah |

## 5. Status dan label

Label status dibangun dari domain (`@/domain/orders`, `@/domain/returns`, `@/domain/shipments`),
bukan string mentah DB, supaya UI konsisten dan dapat diterjemahkan sekali:

- `pending_payment` → "Menunggu pembayaran" (`warning`)
- `processing` → "Sedang diproses" (`info`)
- `shipped` → "Dikirim" (`info`) · `delivered` → "Terkirim" (`success`)
- `cancelled` → "Dibatalkan" (`neutral`) · `refund_requested` → "Refund diminta" (`warning`)
- Retur: `requested`, `awaiting_return`, `item_received`, `inspected`, `resolved`, `rejected`,
  `cancelled`, `expired` (`RETURN_STATUS_LABELS`)

## 6. Larangan yang ditegakkan di kode

Aturan ini ada karena dokumen desain menampilkan pola yang salah untuk produksi:

1. **Mata uang.** Mockup memakai `USD`; produksi wajib `IDR` penuh ( pembulatan rupiah,
   tanpa desimal ) lewat `formatIDR()` — jangan hardcode string harga.
2. **Tidak ada urgensi palsu.** Tanpa hitung mundur "berakhir dalam …" atau label "hampir habis"
   yang tidak dihitung dari stok (`computeStockView`).
3. **Tidak ada klaim lunas.** Status "berhasil/lunas" hanya muncul setelah provider
   mengonfirmasi (`payment_status='succeeded'`), bukan setelah form submit.
4. **Tidak ada ongkir karangan.** Tarif hanya dari adapter (`SHIPPING_SERVICES` mock atau
   kurir nyata); UI tidak mengunci angka di teks.
5. **Tanpa data pribadi di URL/kl ipen** yang bisa disalin: token lacak ≥ 20 karakter,
   alamat sensitif tidak pernah masuk `title`/`alt`.

## 7. Komponen primitif

`src/components/ui/`: `button` (`Button`, `ButtonLink`), `field` (label + `aria-describedby`

- pesan error), `input`, `select`, `textarea`, `checkbox`, `radio-group`, `card`
  (`Card`, `CardHeader`), `badge` (`Badge`, `StatusChip`), `alert` (`tone: info|success|warning|danger`),
  `state` (`Skeleton`, `SkeletonList`, `EmptyState`, `ErrorState`, `LoadingState`),
  `pagination`, `price` (`PriceBlock` membandingkan `price`/`compareAt` + hemat %),
  `table` (`Table`, `Tr`, `Td`).

Komponen ini yang dipakai ulang oleh storefront, akun, dan admin; komponen bisnis
(`src/components/commerce/*`) tidak boleh mendefinisikan warna baru — hanya mengomposisi token.
