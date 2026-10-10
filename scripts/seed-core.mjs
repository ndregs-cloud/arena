/**
 * Inti seed dev/test (dipakai CLI `scripts/seed.mjs` dan test integrasi).
 * Semua nominal integer Rupiah penuh. Gambar = SVG placeholder yang dihasilkan di sini.
 * Tidak ada kata sandi yang dihardcode: pemanggil mengirim `options.password`.
 */
import { createCipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

export const DEV_TOTP_SECRET = "JBSWY3DPEHPK3PXP";
export const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeReference(prefix, at = new Date()) {
  const stamp = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, "0")}${String(at.getDate()).padStart(2, "0")}`;
  let out = "";
  for (const byte of randomBytes(6)) out += ALNUM[byte % ALNUM.length];
  return `${prefix}-${stamp}-${out}`;
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt",
    "16384",
    "8",
    "1",
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export function encryptSecret(plain, authSecret) {
  const key = Buffer.from(createHash("sha256").update(`${authSecret}.enc`).digest("hex"), "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(":");
}

export function pgArray(values) {
  if (!values || values.length === 0) return "{}";
  return `{${values.map((v) => `"${String(v).replaceAll('"', '\\"')}"`).join(",")}}`;
}

const PALETTE = [
  ["#1F2A44", "#315CFF"],
  ["#153039", "#2FA37A"],
  ["#2B1F44", "#8B5CF6"],
  ["#3A2413", "#C2703A"],
  ["#11283A", "#0EA5E9"],
  ["#3A1120", "#DB2777"],
];

function esc(value) {
  return String(value).replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c],
  );
}

export function svgProductImage({ name, brand, index, tone }) {
  const [bg, accent] = PALETTE[tone % PALETTE.length];
  const initial = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000" role="img" aria-label="${esc(`${brand} ${name}`)}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${accent}" stop-opacity=".6"/></linearGradient></defs>
  <rect width="800" height="1000" fill="url(#g)"/>
  <rect x="60" y="60" width="680" height="690" rx="28" fill="#F5F7FB" opacity=".08"/>
  <circle cx="400" cy="400" r="150" fill="#FFFFFF" opacity=".14"/>
  <text x="400" y="435" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="150" font-weight="700" fill="#FFFFFF" text-anchor="middle">${esc(initial)}</text>
  <text x="80" y="810" font-family="system-ui,sans-serif" font-size="34" font-weight="600" fill="#FFFFFF">${esc(brand)}</text>
  <text x="80" y="858" font-family="system-ui,sans-serif" font-size="28" fill="#E3E8F0">${esc(name.slice(0, 44))}</text>
  <text x="80" y="920" font-family="system-ui,sans-serif" font-size="20" fill="#C9D2E3">Placeholder ${index + 1}/4 - bukan foto produk</text>
</svg>`;
}

export function svgBannerImage({ title, subtitle, tone }) {
  const [bg, accent] = PALETTE[tone % PALETTE.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900" role="img" aria-label="${esc(title)}">
  <defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs>
  <rect width="1600" height="900" fill="url(#b)"/>
  <text x="120" y="420" font-family="system-ui,sans-serif" font-size="82" font-weight="700" fill="#FFFFFF">${esc(title)}</text>
  <text x="120" y="500" font-family="system-ui,sans-serif" font-size="36" fill="#E3E8F0">${esc(subtitle)}</text>
</svg>`;
}

/** Tulis placeholder SVG ke public/img; mengembalikan URL publik. */
export function writePlaceholders({ root, products, banners }) {
  const dirs = ["public/img/products", "public/img/banners", "public/img"];
  for (const dir of dirs) mkdirSync(`${root}/${dir}`, { recursive: true });
  const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 32" width="140" height="32" role="img" aria-label="NOVA STORE"><rect width="140" height="32" rx="8" fill="#315CFF"/><text x="16" y="22" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="#FFFFFF" letter-spacing="1">NOVA STORE</text></svg>`;
  writeFileSync(`${root}/public/img/logo.svg`, logo);
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#315CFF"/><text x="16" y="22" font-family="system-ui,sans-serif" font-size="16" font-weight="700" fill="#FFF" text-anchor="middle">N</text></svg>`;
  writeFileSync(`${root}/public/img/favicon.svg`, favicon);
  const media = [];
  for (const product of products) {
    const count = Number(product.imageCount ?? 4);
    for (let i = 0; i < count; i += 1) {
      const file = `${product.slug}-${i + 1}.svg`;
      const path = `${root}/public/img/products/${file}`;
      if (!existsSync(path)) {
        writeFileSync(
          path,
          svgProductImage({
            name: product.name,
            brand: product.brand,
            index: i,
            tone: product.tone ?? i,
          }),
        );
      }
      media.push({
        slug: product.slug,
        url: `/img/products/${file}`,
        position: i,
        alt: `${product.brand} ${product.name} - tampilan ${i + 1}`,
      });
    }
  }
  for (const banner of banners) {
    const path = `${root}/public/img/banners/${banner.file}`;
    if (!existsSync(path)) writeFileSync(path, svgBannerImage(banner));
  }
  return media;
}

// ---------------------------------------------------------------------

const ROLE_DEFS = [
  {
    code: "customer",
    label: "Pelanggan",
    description: "Akun pembeli: keranjang, pesanan, retur.",
    privileged: false,
  },
  {
    code: "catalog_editor",
    label: "Editor katalog",
    description: "Membuat/mengubah produk, varian, dan media.",
    privileged: false,
  },
  {
    code: "merchandiser",
    label: "Merchandiser",
    description: "Promosi, banner, kategori, dan kurasi etalase.",
    privileged: false,
  },
  {
    code: "order_operator",
    label: "Operator pesanan",
    description: "Memproses pesanan, shipment, dan tracking.",
    privileged: false,
  },
  {
    code: "customer_support",
    label: "Layanan pelanggan",
    description: "Melihat pesanan dan mengelola retur (tanpa refund).",
    privileged: false,
  },
  {
    code: "warehouse_operator",
    label: "Operator gudang",
    description: "Melihat dan menyesuaikan stok (butuh approval untuk nilai besar).",
    privileged: false,
  },
  {
    code: "finance",
    label: "Keuangan",
    description: "Laporan, rekonsiliasi, dan persetujuan refund.",
    privileged: false,
  },
  {
    code: "manager",
    label: "Manajer operasional",
    description: "Gabungan katalog, pesanan, stok, dan promosi.",
    privileged: true,
  },
  {
    code: "system_admin",
    label: "Administrator sistem",
    description: "Semua hak termasuk pengaturan, peran, dan integrasi.",
    privileged: true,
  },
  {
    code: "auditor",
    label: "Auditor",
    description: "Baca-only termasuk jejak audit.",
    privileged: false,
  },
];

// Sumber kebenaran permission/peran ada di src/domain/rbac.ts; peta di bawah hanya untuk
// mengisi tabel DB agar konsisten tanpa harus menjalankan kode TypeScript di Node.
const PERMISSION_LABELS = {
  "catalog.view": "Lihat katalog",
  "catalog.view_draft": "Lihat draf produk",
  "catalog.create": "Buat produk",
  "catalog.update": "Ubah produk",
  "catalog.publish": "Terbitkan produk",
  "catalog.archive": "Arsipkan produk",
  "product.price.update": "Ubah harga produk",
  "inventory.view": "Lihat stok",
  "inventory.adjust": "Sesuaikan stok",
  "inventory.approve": "Setujui penyesuaian stok",
  "order.view": "Lihat pesanan",
  "order.process": "Proses pesanan",
  "order.cancel": "Batalkan pesanan",
  "order.refund": "Ajukan refund",
  "refund.approve": "Setujui refund",
  "shipment.manage": "Kelola pengiriman",
  "tracking.manage": "Kelola tracking",
  "return.manage": "Kelola retur",
  "return.approve": "Setujui retur",
  "customer.view": "Lihat data pelanggan",
  "customer.pii.view": "Lihat data pribadi lengkap",
  "customer.manage": "Kelola akun pelanggan",
  "promotion.manage": "Kelola promosi",
  "promotion.approve": "Setujui promosi",
  "content.manage": "Kelola konten & kebijakan",
  "report.view": "Lihat laporan",
  "finance.view": "Lihat data keuangan",
  "audit.view": "Lihat jejak audit",
  "user.manage": "Kelola pengguna",
  "user.role.assign": "Pasang/cabut peran",
  "settings.manage": "Ubah pengaturan",
  "integration.manage": "Kelola integrasi & antrean",
  "review.moderate": "Moderasi ulasan",
  "export.data": "Ekspor data",
};

const ROLE_PERMISSIONS = {
  customer: [],
  catalog_editor: [
    "catalog.view",
    "catalog.view_draft",
    "catalog.create",
    "catalog.update",
    "catalog.publish",
    "catalog.archive",
    "product.price.update",
  ],
  merchandiser: [
    "catalog.view",
    "catalog.view_draft",
    "promotion.manage",
    "content.manage",
    "report.view",
  ],
  order_operator: [
    "catalog.view",
    "order.view",
    "order.process",
    "order.cancel",
    "shipment.manage",
    "tracking.manage",
    "inventory.view",
    "customer.view",
  ],
  customer_support: [
    "catalog.view",
    "order.view",
    "customer.view",
    "return.manage",
    "review.moderate",
  ],
  warehouse_operator: [
    "catalog.view",
    "inventory.view",
    "inventory.adjust",
    "order.view",
    "shipment.manage",
  ],
  finance: [
    "order.view",
    "finance.view",
    "report.view",
    "return.manage",
    "refund.approve",
    "export.data",
    "audit.view",
  ],
  manager: [
    "catalog.view",
    "catalog.view_draft",
    "catalog.create",
    "catalog.update",
    "catalog.publish",
    "product.price.update",
    "inventory.view",
    "inventory.adjust",
    "inventory.approve",
    "order.view",
    "order.process",
    "order.cancel",
    "order.refund",
    "refund.approve",
    "shipment.manage",
    "tracking.manage",
    "return.manage",
    "return.approve",
    "customer.view",
    "promotion.manage",
    "promotion.approve",
    "content.manage",
    "report.view",
    "finance.view",
    "review.moderate",
    "export.data",
  ],
  system_admin: Object.keys(PERMISSION_LABELS),
  auditor: [
    "catalog.view",
    "order.view",
    "inventory.view",
    "finance.view",
    "report.view",
    "audit.view",
    "export.data",
  ],
};

export const ROLE_RESTRICTIONS = {
  merchandiser: "Tidak dapat mengubah ledger pembayaran atau memberi refund.",
  customer_support: "Tidak dapat menyetujui retur/refund; hanya memproses pengajuan.",
  warehouse_operator: "Penyesuaian stok besar membutuhkan penyetuju berbeda.",
  finance: "Tidak dapat mengubah katalog atau stok.",
};

const DEMO_STAFF = [
  { email: "admin@ndre.gstore.test", name: "Rani Administrator", kind: "system_admin" },
  { email: "katalog@ndre.gstore.test", name: "Dedi Katalog", kind: "catalog_editor" },
  { email: "operator@ndre.gstore.test", name: "Putri Operator", kind: "order_operator" },
  { email: "cs@ndre.gstore.test", name: "Bayu Dukungan", kind: "customer_support" },
  { email: "gudang@ndre.gstore.test", name: "Sari Gudang", kind: "warehouse_operator" },
  { email: "keuangan@ndre.gstore.test", name: "Ayu Keuangan", kind: "finance" },
  { email: "manager@ndre.gstore.test", name: "Andi Manajer", kind: "manager" },
  { email: "audit@ndre.gstore.test", name: "Citra Auditor", kind: "auditor" },
];

export const DEMO_CUSTOMER = {
  email: "pelanggan@ndre.gstore.test",
  name: "Budi Santoso",
  phone: "081234567890",
};

const POLICIES = [
  {
    key: "syarat",
    title: "Syarat & Ketentuan",
    body:
      "1. Toko ini menjual produk untuk penggunaan pribadi di wilayah Indonesia.\n" +
      "2. Harga yang tercantum sudah termasuk PPN dan dalam Rupiah (IDR). Ongkos kirim dihitung saat checkout berdasarkan alamat dan berat paket.\n" +
      '3. Pesanan dibuat setelah pembayaran terkonfirmasi oleh penyedia pembayaran; status "menunggu pembayaran" otomatis kedaluwarsa sesuai batas waktu yang ditampilkan di halaman pembayaran.\n' +
      "4. Pembatalan hanya dapat dilakukan selama pesanan belum diserahkan ke kurir. Setelah diserahkan, gunakan prosedur retur.\n" +
      "5. Data pribadi diproses sesuai Kebijakan Privasi dan peraturan yang berlaku (PSE Lingkup Privat, UU Perlindungan Data Pribadi).",
  },
  {
    key: "privasi",
    title: "Kebijakan Privasi",
    body:
      "Data yang kami kumpulkan: nama, kontak, alamat pengiriman, dan riwayat transaksi. Data dipakai untuk memproses pesanan, layanan pelanggan, dan kewajiban pajak.\n" +
      "Email promosi hanya dikirim bila Anda memberikan persetujuan; persetujuan dapat ditarik kapan pun dari halaman Akun > Privasi.\n" +
      "Anda berhak meminta salinan data, koreksi, dan penghapusan data yang tidak wajib disimpan. Data transaksi disimpan sesuai ketentuan pembukuan dan perpajakan yang berlaku.\n" +
      "Kami tidak menjual data pribadi kepada pihak ketiga.",
  },
  {
    key: "pengiriman",
    title: "Kebijakan Pengiriman",
    body:
      'Pengiriman memakai kurir mitra. Angka ongkos kirim dan estimasi pada layar ditandai "Simulasi" selama tarif resmi kurir belum terhubung ke sistem; angka final tetap dihitung ulang saat pesanan dibuat.\n' +
      "Paket dikirim 1-2 hari kerja setelah pembayaran terkonfirmasi. Nomor resi muncul pada halaman detail pesanan setelah paket diserahkan ke kurir.\n" +
      "Estimasi bersifat perkiraan, bukan janji tanggal tiba.",
  },
  {
    key: "retur",
    title: "Kebijakan Retur & Refund",
    body:
      "Pengajuan retur dapat dibuat dalam 14 hari kalender setelah barang diterima, untuk kondisi: rusak saat tiba, barang salah, tidak sesuai deskripsi, ukuran tidak pas, cacat produksi, atau berubah pikiran (barang belum dipakai, label utuh).\n" +
      "Barang harus dikembalikan beserta kemasan. Biaya kirim balik ditanggung toko bila kesalahan kami; bila berubah pikiran, biaya kirim balik ditanggung pelanggan.\n" +
      "Barang diperiksa saat tiba di gudang. Refund nominal mengikuti harga yang dibayar setelah dikurangi potongan yang dialokasikan pada baris terkait. Refund dikirim ke metode pembayaran asal setelah dikonfirmasi penyedia; estimasi 5-14 hari kerja.",
  },
];

/** @param {any} db @param {{password:string,authSecret:string,catalog:typeof import('./seed-catalog.mjs'),imagesRoot?:string,includeDemoOrders?:boolean,now?:Date}} options */
export async function seedAll(db, options) {
  const now = options.now ?? new Date();
  const iso = (offsetMs) => new Date(now.getTime() + offsetMs).toISOString();
  const DAY = 86_400_000;
  const summary = { users: [], products: 0, variants: 0, orders: 0, images: 0 };

  // --- RBAC -------------------------------------------------------------
  const permissions = Object.keys(PERMISSION_LABELS);
  for (const code of permissions) {
    const risk = /refund|finance|price|role|settings/.test(code)
      ? code.startsWith("refund") || code === "finance.view"
        ? "financial"
        : "sensitive"
      : "normal";
    await db.query(
      `INSERT INTO permissions (code, label, risk) VALUES ($1,$2,$3) ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, risk = EXCLUDED.risk`,
      [code, PERMISSION_LABELS[code], risk],
    );
  }
  for (const role of ROLE_DEFS) {
    await db.query(
      `INSERT INTO roles (code, label, description, is_privileged) VALUES ($1,$2,$3,$4)
       ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, is_privileged = EXCLUDED.is_privileged`,
      [role.code, role.label, role.description, role.privileged],
    );
    await db.query(`DELETE FROM role_permissions WHERE role_code = $1`, [role.code]);
    for (const permission of ROLE_PERMISSIONS[role.code] ?? []) {
      await db.query(
        `INSERT INTO role_permissions (role_code, permission_code) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [role.code, permission],
      );
    }
  }

  // --- Lokasi gudang ----------------------------------------------------
  await db.query(
    `INSERT INTO inventory_locations (code, name, kind, timezone, address, is_active)
     VALUES ('MAIN','Gudang Utama (Jakarta)','warehouse','Asia/Jakarta','Jl. Pergudangan Utara No. 12, Jakarta Timur',true),
            ('QRN','Karantina / Retur','quarantine','Asia/Jakarta','Area karantina, Gudang Utama',true)
     ON CONFLICT (code) DO NOTHING`,
  );

  // --- Kategori ---------------------------------------------------------
  const categoryId = new Map();
  for (const category of options.catalog.CATEGORIES) {
    const id = randomUUID();
    const parent = category.parent ? (categoryId.get(category.parent) ?? null) : null;
    const depth = parent ? 2 : 1;
    const path = parent ? [category.parent, category.slug] : [category.slug];
    await db.query(
      `INSERT INTO categories (id, slug, name, description, parent_id, position, image_url, image_alt, is_active, path_slugs, depth)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9::text[],$10)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true`,
      [
        id,
        category.slug,
        category.name,
        category.description ?? null,
        parent,
        category.position ?? 1,
        `/img/categories/${category.slug}.svg`,
        `Ikon kategori ${category.name}`,
        pgArray(path),
        depth,
      ],
    );
    categoryId.set(category.slug, id);
    summary.images += 1;
    if (options.imagesRoot) {
      const dir = `${options.imagesRoot}/public/img/categories`;
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        `${dir}/${category.slug}.svg`,
        svgBannerImage({
          title: category.name,
          subtitle: "Katalog NOVA STORE",
          tone: (category.position ?? 1) + 2,
        }),
      );
    }
  }

  // --- Atribut ----------------------------------------------------------
  for (const attribute of options.catalog.ATTRIBUTE_DEFINITIONS) {
    await db.query(
      `INSERT INTO attribute_definitions (code, label, presentation, is_required, position, allowed_values)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, presentation = EXCLUDED.presentation`,
      [
        attribute.code,
        attribute.label,
        ["swatch", "choice", "numeric"].includes(attribute.presentation)
          ? attribute.presentation
          : "choice",
        Boolean(attribute.isRequired),
        attribute.position ?? 0,
        JSON.stringify(attribute.allowedValues ?? []),
      ],
    );
  }
  for (const id of categoryId.values()) {
    for (const code of ["warna", "ukuran", "materi", "berat_gram"]) {
      await db.query(
        `INSERT INTO category_attributes (category_id, attribute_code, is_filterable, position) VALUES ($1,$2,$3,1) ON CONFLICT DO NOTHING`,
        [id, code, code === "warna" || code === "ukuran"],
      );
    }
  }

  await seedRest(db, {
    now,
    iso,
    DAY,
    summary,
    categoryId,
    password: options.password,
    authSecret: options.authSecret,
    imagesRoot: options.imagesRoot,
    includeDemoOrders: options.includeDemoOrders !== false,
    catalog: options.catalog,
  });
  return summary;
}

/** Produk, varian, media, stok, promosi, kebijakan, pengaturan, banner, pengguna, dan order contoh. */
async function seedRest(db, ctx) {
  const { now, iso, DAY, summary, categoryId, password, authSecret, catalog, includeDemoOrders } =
    ctx;

  // --- Media placeholder ------------------------------------------------
  if (ctx.imagesRoot) {
    writePlaceholders({
      root: ctx.imagesRoot,
      products: catalog.PRODUCTS.map((p, i) => ({
        ...p,
        tone: i,
        imageCount: p.variants.length > 1 ? 4 : 3,
      })),
      banners: [
        {
          file: "hero-1.svg",
          title: "Pilihan audio untuk kerja harian",
          subtitle: "Gratis ongkir mulai Rp300.000 (simulasi tarif)",
          tone: 0,
        },
        {
          file: "hero-2.svg",
          title: "Gadget harian, dikirim dari Jakarta",
          subtitle: "Retur 14 hari, garansi resmi",
          tone: 1,
        },
        {
          file: "collection-kopi.svg",
          title: "Sudut kopi Nusantara",
          subtitle: "Disangrai mingguan oleh perajin lokal",
          tone: 3,
        },
      ],
    });
  }

  // --- Produk & varian ---------------------------------------------------
  const productIds = new Map();
  const variantRows = [];
  for (const [index, product] of catalog.PRODUCTS.entries()) {
    const id = randomUUID();
    const catId = categoryId.get(product.category) ?? null;
    await db.query(
      `INSERT INTO products (id, sku, slug, name, summary, description, brand, status, category_id, attributes, care_instructions, warranty,
                             package_contents, meta_title, meta_description, popularity, published_at, archived_at, retired_slugs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19::text[])
       ON CONFLICT (slug) DO NOTHING`,
      [
        id,
        product.sku,
        product.slug,
        product.name,
        product.summary,
        product.description,
        product.brand,
        product.status,
        catId,
        JSON.stringify(product.attributes ?? {}),
        product.care ?? null,
        product.warranty ?? null,
        JSON.stringify(product.package ?? []),
        `${product.name} | NOVA STORE`,
        (product.summary ?? "").slice(0, 155),
        40 - index * 2,
        product.status === "published" ? iso(-30 * DAY) : null,
        product.status === "archived" ? iso(-5 * DAY) : null,
        product.status === "archived" ? pgArray([`${product.slug}-lama`]) : pgArray([]),
      ],
    );
    productIds.set(product.slug, id);
    summary.products += 1;

    const media = catalog.PRODUCTS[index].variants.length > 1 ? 4 : 3;
    for (let i = 0; i < media; i += 1) {
      await db.query(
        `INSERT INTO product_media (product_id, url, alt_text, position, width, height, format, is_primary)
         VALUES ($1,$2,$3,$4,800,1000,'svg',$5)`,
        [
          id,
          `/img/products/${product.slug}-${i + 1}.svg`,
          `${product.brand} ${product.name} - tampilan ${i + 1}`,
          i,
          i === 0,
        ],
      );
    }

    for (const [vIndex, variant] of product.variants.entries()) {
      const variantId = randomUUID();
      const variantSku = `${product.sku}-${String(vIndex + 1).padStart(2, "0")}`;
      await db.query(
        `INSERT INTO product_variants (id, product_id, sku, label, options, option_values, price_amount, compare_at_amount, currency,
                                       track_inventory, low_stock_threshold, safety_stock, min_qty_per_order, max_qty_per_order, is_active, position)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::text[],$7,$8,'IDR',true,$9,$10,1,$11,true,$12)
         ON CONFLICT (sku) DO NOTHING`,
        [
          variantId,
          id,
          variantSku,
          variant.label,
          JSON.stringify(variant.options ?? {}),
          pgArray(Object.values(variant.options ?? {})),
          variant.price,
          variant.compare_at ?? null,
          5,
          variant.safety ?? 0,
          variant.maxQty ?? 10,
          vIndex,
        ],
      );
      const onHand = variant.onHand ?? 0;
      await db.query(
        `INSERT INTO inventory_balances (location_code, sku, on_hand, reserved, damaged, safety_stock)
         VALUES ('MAIN',$1,$2,0,0,$3) ON CONFLICT (location_code, sku) DO UPDATE SET on_hand = EXCLUDED.on_hand, safety_stock = EXCLUDED.safety_stock`,
        [variantSku, onHand, variant.safety ?? 0],
      );
      if (onHand > 0) {
        await db.query(
          `INSERT INTO inventory_movements (location_code, sku, kind, quantity, balance_before, balance_after, reason_code, note, ref_type, ref_id)
           VALUES ('MAIN',$1,'receipt',$2,0,$2,'opening_balance','Stok awal dari seed dev/test','import',NULL)`,
          [variantSku, onHand],
        );
      }
      variantRows.push({
        variantId,
        variantSku,
        productId: id,
        product,
        variant,
        price: variant.price,
        onHand,
      });
      summary.variants += 1;
    }
  }

  // --- Promosi -----------------------------------------------------------
  const promoStart = iso(-10 * DAY);
  const insertPromo = async (promo) => {
    await db.query(
      `INSERT INTO promotions (code, label, kind, value, min_spend_amount, discount_cap_amount, scope, starts_at, ends_at,
                                usage_limit, used_count, per_customer_limit, stackable, is_active, requires_approval)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (code) DO NOTHING`,
      [
        promo.code,
        promo.label,
        promo.kind,
        promo.value,
        promo.minSpend ?? 0,
        promo.cap ?? null,
        JSON.stringify(promo.scope ?? { kind: "all" }),
        promo.startsAt ?? promoStart,
        promo.endsAt,
        promo.usageLimit ?? null,
        promo.usedCount ?? 0,
        promo.perCustomer ?? null,
        promo.stackable ?? false,
        promo.isActive ?? true,
        promo.requiresApproval ?? false,
      ],
    );
  };
  await insertPromo({
    code: "HERO10",
    label: "Potongan 10% untuk belanja harian",
    kind: "percent",
    value: 1000,
    minSpend: 500_000,
    cap: 250_000,
    endsAt: iso(30 * DAY),
    usageLimit: 500,
    perCustomer: 2,
  });
  await insertPromo({
    code: "ONGKIRGRATIS",
    label: "Gratis ongkir minimal Rp300.000",
    kind: "free_shipping",
    value: 0,
    minSpend: 300_000,
    endsAt: iso(21 * DAY),
    usageLimit: 1000,
  });
  await insertPromo({
    code: "NEWUSER50K",
    label: "Potongan Rp50.000 pengguna baru",
    kind: "fixed",
    value: 50_000,
    minSpend: 400_000,
    endsAt: iso(60 * DAY),
    perCustomer: 1,
  });
  await insertPromo({
    code: "EXPIRED20",
    label: "Promo lama (sudah berakhir)",
    kind: "percent",
    value: 2000,
    minSpend: 0,
    startsAt: iso(-40 * DAY),
    endsAt: iso(-10 * DAY),
  });
  await insertPromo({
    code: "LIMIT1",
    label: "Kode stok terbatas untuk uji batas pemakaian",
    kind: "fixed",
    value: 25_000,
    minSpend: 0,
    usageLimit: 1,
    endsAt: iso(90 * DAY),
  });
  await insertPromo({
    code: "APPROVE25",
    label: "Promo menunggu persetujuan (uji maker-checker)",
    kind: "percent",
    value: 2500,
    minSpend: 250_000,
    endsAt: iso(45 * DAY),
    isActive: false,
    requiresApproval: true,
  });

  // --- Kebijakan ---------------------------------------------------------
  for (const policy of POLICIES) {
    await db.query(
      `INSERT INTO policies (key, version, title, body, effective_at, is_current)
       VALUES ($1,1,$2,$3,$4,true) ON CONFLICT (key, version) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, is_current = true`,
      [policy.key, policy.title, policy.body, iso(-15 * DAY)],
    );
  }

  // --- Pengaturan & banner ------------------------------------------------
  const settings = [
    [
      "stock_adjustment_approval_threshold",
      1_000_000,
      "Penyesuaian stok >= nilai ini butuh persetujuan aktor lain.",
    ],
    [
      "low_stock_threshold_default",
      5,
      "Ambang stok rendah default untuk varian tanpa ambang sendiri.",
    ],
    [
      "store_notice",
      "Pengiriman dari Jakarta. Ongkos kirim pada layar adalah simulasi sampai tarif kurir resmi terhubung.",
      "Teks pengumuman di beranda.",
    ],
    ["support_contact", "halo@ndre.gstore.test (data contoh)", "Kontak layanan pelanggan."],
    ["maintenance_mode", false, "Bila aktif, storefront menampilkan halaman pemeliharaan."],
  ];
  for (const [key, value, description] of settings) {
    await db.query(
      `INSERT INTO site_settings (key, value, description, updated_at) VALUES ($1,$2::jsonb,$3,now())
       ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`,
      [key, JSON.stringify({ value }), description],
    );
  }
  const bannerInserts = [
    [
      "home_hero",
      "Pilihan audio untuk kerja harian",
      "Gratis ongkir mulai Rp300.000 - kode ONGKIRGRATIS",
      "/kategori/audio?coupon=ONGKIRGRATIS",
      "/img/banners/hero-1.svg",
      1,
    ],
    [
      "home_hero",
      "Gadget harian, dikirim dari Jakarta",
      "Retur 14 hari, garansi resmi",
      "/cari",
      "/img/banners/hero-2.svg",
      2,
    ],
    [
      "home_collection",
      "Sudut kopi Nusantara",
      "Disangrai mingguan oleh perajin lokal",
      "/kategori/kopi",
      "/img/banners/collection-kopi.svg",
      1,
    ],
  ];
  for (const [position, title, subtitle, href, imageUrl, sortOrder] of bannerInserts) {
    await db.query(
      `INSERT INTO campaign_banners (position, title, subtitle, image_url, image_alt, href, starts_at, ends_at, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9)`,
      [position, title, subtitle, imageUrl, title, href, iso(-3 * DAY), iso(45 * DAY), sortOrder],
    );
  }

  // --- Pengguna ----------------------------------------------------------
  const storedHash = hashPassword(password);
  const userIds = {};
  for (const staff of DEMO_STAFF) {
    const res = await db.query(
      `INSERT INTO users (email, password_hash, password_algo, full_name, phone, kind, is_active, email_verified_at, mfa_secret_enc, mfa_enabled_at, last_login_at)
       VALUES ($1,$2,'scrypt',$3,'08123450${String(1000 + summary.users.length).slice(-4)}','staff',true,now(),$4,now(),now())
       ON CONFLICT (email_normalized) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true
       RETURNING id`,
      [staff.email, storedHash, staff.name, encryptSecret(DEV_TOTP_SECRET, authSecret)],
    );
    const id = res.rows[0]?.id;
    userIds[staff.kind] = id;
    userIds[staff.email] = id;
    if (id) {
      await db.query(
        `INSERT INTO customer_profiles (user_id, marketing_consent, locale, timezone) VALUES ($1,false,'id-ID','Asia/Jakarta') ON CONFLICT (user_id) DO NOTHING`,
        [id],
      );
      await db.query(
        `INSERT INTO user_roles (user_id, role_code) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, staff.kind],
      );
      summary.users.push({ role: staff.kind, email: staff.email });
    }
  }
  const customerRes = await db.query(
    `INSERT INTO users (email, password_hash, password_algo, full_name, phone, kind, is_active, email_verified_at)
     VALUES ($1,$2,'scrypt',$3,$4,'customer',true,now())
     ON CONFLICT (email_normalized) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true
     RETURNING id`,
    [DEMO_CUSTOMER.email, storedHash, DEMO_CUSTOMER.name, DEMO_CUSTOMER.phone],
  );
  const customerId = customerRes.rows[0]?.id;
  userIds.customer = customerId;
  if (customerId) {
    await db.query(
      `INSERT INTO customer_profiles (user_id, marketing_consent, locale, timezone) VALUES ($1,true,'id-ID','Asia/Jakarta') ON CONFLICT (user_id) DO NOTHING`,
      [customerId],
    );
    await db.query(
      `INSERT INTO user_roles (user_id, role_code) VALUES ($1,'customer') ON CONFLICT DO NOTHING`,
      [customerId],
    );
    await db.query(
      `INSERT INTO addresses (user_id, label, full_name, phone, province, city, district, postal_code, street, landmark, is_default)
       VALUES ($1,'rumah',$2,$3,'DKI Jakarta','Jakarta Timur','Cipayung','13840','Jl. Raya Bogor Km 18 No. 27, RT 04/RW 02','Seberang minimarket',true)
       ON CONFLICT DO NOTHING`,
      [customerId, DEMO_CUSTOMER.name, DEMO_CUSTOMER.phone],
    );
    await db.query(
      `INSERT INTO addresses (user_id, label, full_name, phone, province, city, district, postal_code, street, is_default)
       VALUES ($1,'kantor',$2,$3,'Jawa Barat','Bandung','Coblong','40171','Jl. Dipatiukur No. 10, Lantai 3',false)`,
      [customerId, DEMO_CUSTOMER.name, DEMO_CUSTOMER.phone],
    );
    summary.users.push({ role: "customer", email: DEMO_CUSTOMER.email });
  }

  // --- Ulasan --------------------------------------------------------------
  if (variantRows.length > 0) {
    const reviewTargets = [
      {
        skuProduct: variantRows[0].productId,
        rating: 5,
        title: "Peredam bising works",
        body: "Dipakai commute 1,5 jam/hari, bising kereta hilang. Baterai tahan 3 hari pemakaian.",
      },
      {
        skuProduct: variantRows[0].productId,
        rating: 4,
        title: "Nyaman, bantalan agak hangat",
        body: "Kualitas suara bagus. Untuk cuaca panas bantalan agak pengap setelah 3 jam.",
      },
      {
        skuProduct: variantRows[8]?.productId ?? variantRows[0].productId,
        rating: 5,
        title: "Gilingan konsisten",
        body: "Burr stabil, 38 klik cukup untuk pour over. Body kayu rapi.",
      },
    ];
    for (const target of reviewTargets) {
      await db.query(
        `INSERT INTO reviews (product_id, author_id, rating, title, body, status, is_verified_purchase, created_at)
         VALUES ($1,$2,$3,$4,$5,'published',true,now() - interval '6 days')`,
        [target.skuProduct, customerId, target.rating, target.title, target.body],
      );
    }
    await db.query(
      `INSERT INTO reviews (product_id, rating, title, body, status, is_verified_purchase, created_at)
       VALUES ($1,3,$2,$3,'pending',false,now() - interval '1 day')`,
      [
        variantRows[0].productId,
        "Pengiriman lambat 6 hari",
        "Produk bagus tapi kurirnya lama. Menunggu moderasi karena menyebut identitas penerima di bagian akhir ulasan.",
      ],
    );
    await db.query(`
      INSERT INTO product_review_stats (product_id, average, review_count, updated_at)
      SELECT product_id, ROUND(AVG(rating)::numeric, 2), count(*)::int, now() FROM reviews WHERE status = 'published' GROUP BY product_id
      ON CONFLICT (product_id) DO UPDATE SET average = EXCLUDED.average, review_count = EXCLUDED.review_count, updated_at = now()`);
  }

  if (!includeDemoOrders || !customerId) return summary;

  // --- Order contoh -------------------------------------------------------
  const lineFor = (index, quantity, discountPerLine = 0) => {
    const item = variantRows[index];
    return { item, quantity, discount: discountPerLine };
  };

  /** @type {Array<{status:string,payment:string,fulfill:string,lines:any[],shipping:number,discount:number,promo?:string,ageDays:number,withShipment?:boolean,withReturn?:boolean,cancelReason?:string}>} */
  const orders = [
    {
      status: "delivered",
      payment: "succeeded",
      fulfill: "delivered",
      shipping: 22_000,
      discount: 125_000,
      promo: "HERO10",
      ageDays: 21,
      withShipment: true,
      withReturn: true,
      lines: [lineFor(0, 1, 105_000), lineFor(8, 1, 20_000)],
    },
    {
      status: "shipped",
      payment: "succeeded",
      fulfill: "shipped",
      shipping: 32_000,
      discount: 0,
      ageDays: 4,
      withShipment: true,
      lines: [lineFor(6, 1), lineFor(10, 1)],
    },
    {
      status: "paid",
      payment: "succeeded",
      fulfill: "unfulfilled",
      shipping: 0,
      discount: 0,
      ageDays: 1,
      lines: [lineFor(1, 1)],
    },
    {
      status: "pending_payment",
      payment: "awaiting_payment",
      fulfill: "unfulfilled",
      shipping: 22_000,
      discount: 0,
      ageDays: 0,
      lines: [lineFor(2, 1)],
    },
    {
      status: "cancelled",
      payment: "expired",
      fulfill: "cancelled",
      shipping: 22_000,
      discount: 0,
      ageDays: 9,
      cancelReason: "Melewat batas waktu pembayaran",
      lines: [lineFor(9, 1)],
    },
  ];

  let orderCount = 0;
  for (const demo of orders) {
    const orderId = randomUUID();
    const orderNumber = makeReference("NS", now);
    const trackingToken = randomBytes(16)
      .toString("base64url")
      .replace(/[^A-Za-z0-9]/g, "x")
      .slice(0, 26);
    const createdAt = iso(-demo.ageDays * DAY);
    const subtotal = demo.lines.reduce((acc, l) => acc + l.item.price * l.quantity, 0);
    const total = subtotal - demo.discount + demo.shipping;
    const addressRes = await db.query(
      `SELECT full_name, phone, province, city, district, postal_code, street, landmark FROM addresses WHERE user_id = $1 AND is_default = true`,
      [customerId],
    );
    const addr = addressRes.rows[0] ?? {};
    const shippingAddress = {
      fullName: addr.full_name ?? DEMO_CUSTOMER.name,
      phone: addr.phone ?? DEMO_CUSTOMER.phone,
      province: addr.province ?? "DKI Jakarta",
      city: addr.city ?? "Jakarta Timur",
      district: addr.district ?? "Cipayung",
      postalCode: addr.postal_code ?? "13840",
      street: addr.street ?? "Jl. Raya Bogor Km 18 No. 27",
      landmark: addr.landmark ?? null,
      zoneCode: "JABODETABEK",
    };
    let promoId = null;
    if (demo.promo) {
      const promoRes = await db.query(`SELECT id FROM promotions WHERE code = $1`, [demo.promo]);
      promoId = promoRes.rows[0]?.id ?? null;
    }
    const inserted = await db.query(
      `INSERT INTO orders (id, order_number, tracking_token, customer_id, email, phone, status, payment_status, fulfillment_status,
                           currency, subtotal_amount, discount_amount, shipping_amount, fee_amount, total_amount, refunded_amount,
                           promotion_id, shipping_address, shipping_selection, policy_version, marketing_consent, customer_note,
                           created_at, updated_at, paid_at, shipped_at, delivered_at, completed_at, cancelled_at, cancel_reason, expires_at, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'IDR',$10,$11,$12,0,$13,0,$14,$15::jsonb,$16::jsonb,'syarat-v1',true,$17,$18,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       RETURNING id`,
      [
        orderId,
        orderNumber,
        trackingToken,
        customerId,
        DEMO_CUSTOMER.email,
        DEMO_CUSTOMER.phone,
        demo.status,
        demo.payment,
        demo.fulfill,
        subtotal,
        demo.discount,
        demo.shipping,
        total,
        promoId,
        JSON.stringify(shippingAddress),
        JSON.stringify({
          carrierCode: "simulated",
          serviceCode: demo.shipping === 0 ? "pickup" : "reguler",
          serviceName: "Reguler (Simulasi)",
          costAmount: demo.shipping,
          estimateLabel: "Estimasi 2-4 hari kerja",
          isSimulated: true,
        }),
        "Data contoh dari skrip seed - bukan transaksi nyata.",
        createdAt,
        demo.payment === "succeeded" ? iso(-(demo.ageDays - 0.02) * DAY) : null,
        demo.withShipment ? iso(-(demo.ageDays - 1) * DAY) : null,
        demo.status === "delivered" ? iso(-Math.max(0.5, demo.ageDays - 2) * DAY) : null,
        demo.status === "delivered" ? iso(-Math.max(0.5, demo.ageDays - 2) * DAY) : null,
        demo.status === "cancelled" ? iso(-(demo.ageDays - 0.05) * DAY) : null,
        demo.cancelReason ?? null,
        demo.status === "pending_payment" ? new Date(Date.now() + 12 * 60_000).toISOString() : null,
        `seed:${orderNumber}`,
      ],
    );
    const realId = inserted.rows[0]?.id ?? orderId;
    orderCount += 1;

    for (const [lineIndex, line] of demo.lines.entries()) {
      await db.query(
        `INSERT INTO order_items (order_id, product_id, variant_id, sku, name_snapshot, variant_label_snapshot, unit_price_amount, quantity,
                                  discount_allocated_amount, image_url, is_returnable)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)`,
        [
          realId,
          line.item.productId,
          line.item.variantId,
          line.item.variantSku,
          line.item.product.name,
          line.item.variant.label,
          line.item.price,
          line.quantity,
          line.discount,
          `/img/products/${line.item.product.slug}-1.svg`,
        ],
      );
      if (lineIndex === 0) {
        await db.query(
          `INSERT INTO order_events (order_id, event_type, to_status, actor_kind, visibility, note, created_at)
           VALUES ($1,'order_created',$2,'system','customer',$3,$4)`,
          [realId, "pending_payment", "Pesanan contoh dibuat oleh skrip seed.", createdAt],
        );
      }
      if (demo.payment === "succeeded") {
        await db.query(
          `INSERT INTO order_events (order_id, event_type, from_status, to_status, actor_kind, visibility, note, created_at)
           VALUES ($1,'payment_succeeded','pending_payment','paid','system','customer','Pembayaran terkonfirmasi oleh penyedia (data contoh).',$2)`,
          [realId, iso(-(demo.ageDays - 0.02) * DAY)],
        );
      }
      if (demo.status === "cancelled") {
        await db.query(
          `INSERT INTO order_events (order_id, event_type, from_status, to_status, actor_kind, visibility, note, created_at)
           VALUES ($1,'order_cancelled','pending_payment','cancelled','system','customer','Pesanan kedaluwarsa sebelum dibayar (data contoh).',$2)`,
          [realId, iso(-(demo.ageDays - 0.05) * DAY)],
        );
      }
      if (demo.status === "delivered") {
        await db.query(
          `INSERT INTO order_events (order_id, event_type, actor_kind, visibility, note, created_at)
           VALUES ($1,'review_invited','system','customer','Undangan menulis ulasan dikirim (data contoh).',$2)`,
          [realId, iso(-Math.max(0.5, demo.ageDays - 2) * DAY)],
        );
      }
    }

    if (demo.payment === "succeeded") {
      await db.query(
        `INSERT INTO payment_attempts (order_id, provider_code, provider_ref, method_code, method_name, amount, currency, status, instructions, is_simulated, succeeded_at, created_at, idempotency_key)
         VALUES ($1,'mock',NULL,'va_bca','Transfer BCA Virtual Account',$2,'IDR','succeeded',$3,true,$4,$4,$5)`,
        [
          realId,
          total,
          "Data contoh: nomor VA simulasi 880800000000001. Status lunas hanya dari webhook penyedia.",
          iso(-(demo.ageDays - 0.02) * DAY),
          `seed:${orderNumber}:pay`,
        ],
      );
    } else if (demo.status === "pending_payment") {
      await db.query(
        `INSERT INTO payment_attempts (order_id, provider_code, provider_ref, method_code, method_name, amount, currency, status, instructions, is_simulated, created_at, updated_at, idempotency_key)
         VALUES ($1,'mock',NULL,'qris','QRIS (Simulasi)',$2,'IDR','pending',$3,true,now(),now(),$4)`,
        [
          realId,
          total,
          "Pindai QRIS pada halaman pembayaran simulasi. Batas bayar mengikuti pengaturan dev.",
          `seed:${orderNumber}:pay`,
        ],
      );
    }

    if (demo.withShipment) {
      const shipmentId = randomUUID();
      const trackingNumber = `ID${randomBytes(6).toString("hex").toUpperCase()}`;
      await db.query(
        `INSERT INTO shipments (id, order_id, carrier_code, service_code, tracking_number, status, package_count, label_ref, note, is_tracking_manual, created_by, shipped_at, delivered_at, created_at)
         VALUES ($1,$2,'simulated','reguler',$3,$4,1,$5,$6,true,$7,$8,$9,$8)`,
        [
          shipmentId,
          realId,
          trackingNumber,
          demo.status === "delivered" ? "delivered" : "in_transit",
          `MANUAL-${trackingNumber.slice(-6)}`,
          demo.status === "delivered"
            ? "Diterima penerima di rumah"
            : "Dalam perjalanan ke hub tujuan",
          userIds.order_operator ?? null,
          iso(-(demo.ageDays - 1) * DAY),
          demo.status === "delivered" ? iso(-Math.max(0.5, demo.ageDays - 2) * DAY) : null,
        ],
      );
      const events =
        demo.status === "delivered"
          ? [
              ["created", "Paket diterima di hub asal", "Jakarta Timur", -3],
              ["in_transit", "Transit ke hub tujuan", "Bekasi", -2.5],
              ["out_for_delivery", "Diantar kurir", "Jakarta Timur", -2.2],
              ["delivered", "Terkirim", "Diterima penerima", -2],
            ]
          : [
              ["created", "Paket diterima di hub asal", "Jakarta Timur", -3],
              ["in_transit", "Transit ke hub tujuan", "Bekasi", -1.2],
            ];
      for (const [status, label, location, offset] of events) {
        await db.query(
          `INSERT INTO tracking_events (shipment_id, status, status_label, location, occurred_at, source)
           VALUES ($1,$2,$3,$4,$5,'manual')`,
          [shipmentId, status, label, location, iso(offset * DAY)],
        );
      }
    }

    if (demo.withReturn) {
      const returnId = randomUUID();
      const returnRef = makeReference("RET", now);
      await db.query(
        `INSERT INTO returns (id, reference, order_id, customer_id, status, reason_code, description, resolution, policy_version,
                              requested_amount, approved_amount, decision_note, deadline_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'awaiting_return','damaged_on_arrival',$5,'refund','retur-v1',$6,$6,$7,$8,$9,$9)`,
        [
          returnId,
          returnRef,
          realId,
          customerId,
          "Kotak penyok dan bantalan kiri retak saat paket dibuka. Foto sudah dilampirkan saat pengajuan.",
          105_000,
          "Disetujui. Kirim balik ke gudang MAIN sebelum tenggat; kami ganti setelah pemeriksaan.",
          iso(6 * DAY),
          iso(-2 * DAY),
        ],
      );
      const itemRes = await db.query(
        `SELECT id, order_id FROM order_items WHERE order_id = $1 ORDER BY id LIMIT 1`,
        [realId],
      );
      const orderItemId = itemRes.rows[0]?.id;
      if (orderItemId) {
        await db.query(
          `INSERT INTO return_items (return_id, order_item_id, quantity_requested, amount) VALUES ($1,$2,1,$3)`,
          [returnId, orderItemId, 105_000],
        );
      }
      await db.query(
        `INSERT INTO return_events (return_id, event_type, from_status, to_status, note, visibility, created_at)
         VALUES ($1,'requested','requested','requested','Pengajuan dibuat pelanggan (data contoh).','customer',$2),
                ($1,'approved','requested','awaiting_return','Disetujui layanan pelanggan (data contoh).','customer',$2)`,
        [returnId, iso(-2 * DAY)],
      );
      await db.query(
        `UPDATE orders SET status = 'return_requested', fulfillment_status = 'partially_returned', updated_at = now() WHERE id = $1`,
        [realId],
      );
    }
  }
  summary.orders = orderCount;
  return summary;
}
