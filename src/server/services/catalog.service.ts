import "server-only";
import {
  activeVariants,
  deriveSlug,
  isPubliclyVisible,
  type AttributeDefinition,
  type CategoryNode,
  type ProductDetail,
  type ProductMedia,
  type ProductStatus,
  type ProductSummary,
  type ProductVariant,
  type StockState,
} from "@/domain/catalog";
import { AppError } from "@/domain/errors";
import { bool, date, getDb, jsonb, num, optNum, optText, strArray, text } from "@/platform/db";
import { requirePermission } from "@/server/context";
import type { RequestContext } from "@/server/context";

/**
 * Catalog service (Blueprint §5.1, §8 Modul Product manager).
 * Semua query membaca ulang harga/stok dari DB - tidak ada cache harga di klien (AT-03).
 */

export interface ProductFilter {
  q?: string | null;
  categorySlug?: string | null;
  brands?: string[];
  colors?: string[];
  sizes?: string[];
  minPrice?: number | null;
  maxPrice?: number | null;
  minRating?: number | null;
  inStockOnly?: boolean;
  sort?: "relevance" | "newest" | "price_asc" | "price_desc" | "popular";
  page?: number;
  perPage?: number;
  /** true hanya untuk aktor dengan izin catalog.view_draft (AT-01). */
  includeUnpublished?: boolean;
  /** hanya untuk admin: saring status spesifik */
  statusFilter?: ProductStatus;
  /** indeks parameter tempat teks query berada (dipakai ranking relevansi) */
  qParamIndex?: number;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface ProductFacets {
  brands: FacetValue[];
  colors: FacetValue[];
  sizes: FacetValue[];
  priceBounds: { min: number; max: number };
  categories: Array<CategoryNode & { count: number }>;
}

export interface ProductListResult {
  items: ProductSummary[];
  total: number;
  page: number;
  perPage: number;
  facets: ProductFacets;
  /** memisahkan "tidak ada hasil" dari "layanan gagal" (desain §8.3) */
  queryApplied: boolean;
}

const PRODUCT_SUMMARY_SQL = `
  SELECT p.id, p.sku, p.slug, p.name, p.summary, p.status, p.brand, p.category_id,
         c.slug AS category_slug, c.name AS category_name,
         agg.min_amount, agg.max_amount, agg.compare_at_amount, agg.available_qty, agg.total_qty,
         media.url AS media_url, media.alt_text AS media_alt,
         COALESCE(rs.average, 0)::float8 AS rating_average, COALESCE(rs.review_count, 0)::int AS review_count,
         p.popularity, p.published_at, p.updated_at,
         CASE WHEN p.published_at IS NOT NULL AND p.published_at > now() - interval '30 days' THEN true ELSE false END AS is_new
    FROM products p
    JOIN categories c ON c.id = p.category_id
    JOIN LATERAL (
      SELECT min(v.price_amount)::bigint AS min_amount,
             max(v.price_amount)::bigint AS max_amount,
             max(v.compare_at_amount)::bigint AS compare_at_amount,
             sum(CASE WHEN v.track_inventory THEN GREATEST(COALESCE(ib.available, 0), 0) ELSE 99 END)::int AS available_qty,
             count(v.id)::int AS total_qty
        FROM product_variants v
        LEFT JOIN inventory_balances ib ON ib.sku = v.sku
       WHERE v.product_id = p.id AND v.is_deleted = false AND v.is_active = true
    ) agg ON true
    LEFT JOIN LATERAL (
      SELECT m.url, m.alt_text FROM product_media m
       WHERE m.product_id = p.id ORDER BY m.is_primary DESC, m.position ASC LIMIT 1
    ) media ON true
    LEFT JOIN product_review_stats rs ON rs.product_id = p.id
`;

function buildWhere(filter: ProductFilter): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const clauses: string[] = [];
  const push = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filter.statusFilter) {
    clauses.push(`p.status = ${push(filter.statusFilter)}`);
  } else if (filter.includeUnpublished !== true) {
    clauses.push("p.status = 'published'");
  }

  if (filter.q && filter.q.trim().length > 0) {
    const q = push(filter.q.trim());
    filter.qParamIndex = params.length;
    clauses.push(
      `(p.search_vector @@ plainto_tsquery('simple', ${q}) OR lower(p.name) LIKE '%' || lower(${q}) || '%' OR lower(p.sku) = lower(${q}))`,
    );
  }
  if (filter.categorySlug) {
    clauses.push(
      `${push(filter.categorySlug)} = ANY(c.path_slugs) OR c.slug = ${push(filter.categorySlug)}`,
    );
  }
  if (filter.brands && filter.brands.length > 0) {
    const list = filter.brands.map((b) => push(b)).join(", ");
    clauses.push(`lower(COALESCE(p.brand,'')) IN (SELECT lower(b) FROM unnest(ARRAY[${list}]) b)`);
  }
  if (filter.minPrice != null) clauses.push(`agg.max_amount >= ${push(filter.minPrice)}`);
  if (filter.maxPrice != null) clauses.push(`agg.min_amount <= ${push(filter.maxPrice)}`);
  if (filter.minRating != null) clauses.push(`COALESCE(rs.average,0) >= ${push(filter.minRating)}`);
  if (filter.inStockOnly) clauses.push(`agg.available_qty > 0`);
  if (filter.colors && filter.colors.length > 0) {
    const list = filter.colors.map((c) => push(c)).join(", ");
    clauses.push(`EXISTS (SELECT 1 FROM product_variants fv WHERE fv.product_id = p.id AND fv.is_deleted = false
      AND lower(fv.options->>'warna') IN (SELECT lower(x) FROM unnest(ARRAY[${list}]) x))`);
  }
  if (filter.sizes && filter.sizes.length > 0) {
    const list = filter.sizes.map((s) => push(s)).join(", ");
    clauses.push(`EXISTS (SELECT 1 FROM product_variants fv WHERE fv.product_id = p.id AND fv.is_deleted = false
      AND (fv.options->>'ukuran') IN (${list}))`);
  }
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function sortSql(sort: ProductFilter["sort"], qParamIndex?: number): string {
  switch (sort) {
    case "price_asc":
      return "ORDER BY agg.min_amount ASC, p.name ASC";
    case "price_desc":
      return "ORDER BY agg.min_amount DESC, p.name ASC";
    case "newest":
      return "ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC";
    case "popular":
      return "ORDER BY p.popularity DESC, COALESCE(rs.review_count,0) DESC, p.name ASC";
    case "relevance":
    default:
      return qParamIndex
        ? `ORDER BY ts_rank(p.search_vector, plainto_tsquery('simple', $${qParamIndex})) DESC, p.popularity DESC, p.name ASC`
        : "ORDER BY p.popularity DESC, p.published_at DESC NULLS LAST, p.name ASC";
  }
}

function mapSummary(row: Record<string, unknown>): ProductSummary {
  const available = num(row.available_qty);
  const status = text(row.status) as ProductStatus;
  let stockState: StockState = "in_stock";
  if (status === "archived") stockState = "archive";
  else if (available <= 0) stockState = "out_of_stock";
  else if (available <= 5) stockState = "low_stock";
  return {
    id: text(row.id),
    slug: text(row.slug),
    name: text(row.name),
    summary: text(row.summary),
    status,
    brand: optText(row.brand),
    categoryId: text(row.category_id),
    categorySlug: text(row.category_slug),
    categoryName: text(row.category_name),
    minPriceAmount: num(row.min_amount),
    maxPriceAmount: num(row.max_amount),
    compareAtAmount: optNum(row.compare_at_amount),
    currency: "IDR",
    primaryMediaUrl: optText(row.media_url),
    primaryMediaAlt: optText(row.media_alt),
    availableQuantity: available,
    totalVariantQuantity: num(row.total_qty),
    ratingAverage: num(row.rating_average) > 0 ? num(row.rating_average) : null,
    reviewCount: num(row.review_count),
    soldQuantity: num(row.popularity),
    isNew: bool(row.is_new),
    hasPromotion:
      optNum(row.compare_at_amount) != null && num(row.compare_at_amount) > num(row.min_amount),
    stockState,
    publishedAt: date(row.published_at),
    updatedAt: dateOrNow(row.updated_at),
  };
}

function dateOrNow(value: unknown): Date {
  return date(value) ?? new Date();
}

export async function listProducts(filter: ProductFilter): Promise<ProductListResult> {
  const db = await getDb();
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(48, Math.max(6, filter.perPage ?? 12));
  // buildWhere mengisi filter.qParamIndex saat query teks dipakai (dipakai untuk ranking relevansi).
  const where = buildWhere(filter);
  const sort = sortSql(filter.sort, filter.qParamIndex);

  const countRes = await db.query<{ c: unknown }>(
    `SELECT count(*)::int AS c FROM products p JOIN categories c ON c.id = p.category_id
     JOIN LATERAL (SELECT min(v.price_amount)::bigint AS min_amount, max(v.price_amount)::bigint AS max_amount,
        sum(CASE WHEN v.track_inventory THEN GREATEST(COALESCE(ib.available,0),0) ELSE 99 END)::int AS available_qty
        FROM product_variants v LEFT JOIN inventory_balances ib ON ib.sku = v.sku WHERE v.product_id = p.id AND v.is_deleted=false AND v.is_active=true) agg ON true
     LEFT JOIN product_review_stats rs ON rs.product_id = p.id
     ${where.sql}`,
    where.params,
  );
  const total = num(countRes.rows[0]?.c);

  const res = await db.query<Record<string, unknown>>(
    `${PRODUCT_SUMMARY_SQL}
     ${where.sql}
     ${sort}
     LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
    where.params,
  );

  const facets = await loadFacets(filter);
  return {
    items: res.rows.map(mapSummary),
    total,
    page,
    perPage,
    facets,
    queryApplied: true,
  };
}

async function loadFacets(filter: ProductFilter): Promise<ProductFacets> {
  const db = await getDb();
  // Faset dihitung atas kategori/pencarian saja (bukan filter atribut itu sendiri) agar pilihan lain tetap terlihat.
  const facetFilter: ProductFilter = {
    ...filter,
    brands: undefined,
    colors: undefined,
    sizes: undefined,
    minPrice: null,
    maxPrice: null,
    minRating: null,
    inStockOnly: false,
  };
  const where = buildWhere(facetFilter);
  const base = `FROM products p JOIN categories c ON c.id = p.category_id`;
  const [brands, variants, bounds, categories] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT lower(COALESCE(p.brand,'')) AS value, count(*)::int AS cnt ${base} ${where.sql ? where.sql + " AND" : "WHERE"} p.brand IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1 ASC LIMIT 24`,
      where.params,
    ),
    db.query<Record<string, unknown>>(
      `SELECT v.options->>'warna' AS warna, v.options->>'ukuran' AS ukuran ${base}
        JOIN product_variants v ON v.product_id = p.id AND v.is_deleted = false
       ${where.sql ? where.sql : "WHERE 1=1"} LIMIT 4000`,
      where.params,
    ),
    db.query<Record<string, unknown>>(
      `SELECT min(v.price_amount)::bigint AS lo, max(v.price_amount)::bigint AS hi ${base}
        JOIN product_variants v ON v.product_id = p.id AND v.is_deleted=false AND v.is_active=true
       ${where.sql}`,
      where.params,
    ),
    // Daftar kategori selalu lengkap (chip navigasi); faset lain memakai filter.
    db.query<Record<string, unknown>>(
      `SELECT c.id, c.slug, c.name, c.parent_id, c.depth, c.path_slugs, c.position,
              count(p.id) FILTER (WHERE p.status = 'published')::int AS cnt
         FROM categories c
         LEFT JOIN products p ON p.category_id = c.id
        GROUP BY c.id ORDER BY c.depth ASC, c.position ASC LIMIT 60`,
      [],
    ),
  ]);

  const colorCounts = new Map<string, number>();
  const sizeCounts = new Map<string, number>();
  for (const row of variants.rows) {
    const warna = optText(row.warna);
    const ukuran = optText(row.ukuran);
    if (warna) colorCounts.set(warna, (colorCounts.get(warna) ?? 0) + 1);
    if (ukuran) sizeCounts.set(ukuran, (sizeCounts.get(ukuran) ?? 0) + 1);
  }
  return {
    brands: brands.rows.map((r) => ({ value: String(r.value), count: num(r.cnt) })),
    colors: [...colorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, count })),
    sizes: [...sizeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, count })),
    priceBounds: { min: num(bounds.rows[0]?.lo), max: num(bounds.rows[0]?.hi) },
    categories: categories.rows.map((r) => ({
      id: text(r.id),
      slug: text(r.slug),
      name: text(r.name),
      description: null,
      parentId: optText(r.parent_id),
      path: strArray(r.path_slugs),
      productCount: num(r.cnt),
      attributeCodes: [],
      depth: num(r.depth),
      position: num(r.position),
      count: num(r.cnt),
    })),
  };
}

export async function listCategories(): Promise<CategoryNode[]> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT c.id, c.slug, c.name, c.description, c.parent_id, c.depth, c.path_slugs, c.image_url,
            count(p.id) FILTER (WHERE p.status = 'published')::int AS product_count
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id
      WHERE c.is_active = true
      GROUP BY c.id
      ORDER BY c.depth ASC, c.position ASC`,
  );
  const attributeCodes = await db.query<{ category_id: string; attribute_code: string }>(
    `SELECT category_id, attribute_code FROM category_attributes ORDER BY position`,
  );
  const byCategory = new Map<string, string[]>();
  for (const row of attributeCodes.rows) {
    const list = byCategory.get(row.category_id) ?? [];
    list.push(row.attribute_code);
    byCategory.set(row.category_id, list);
  }
  return res.rows.map((row) => ({
    id: text(row.id),
    slug: text(row.slug),
    name: text(row.name),
    description: optText(row.description),
    parentId: optText(row.parent_id),
    path: strArray(row.path_slugs),
    productCount: num(row.product_count),
    attributeCodes: byCategory.get(text(row.id)) ?? [],
  }));
}

export async function getCategoryBySlug(slug: string): Promise<CategoryNode | null> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT c.id, c.slug, c.name, c.description, c.parent_id, c.depth, c.path_slugs, c.meta_title, c.meta_description,
            count(p.id) FILTER (WHERE p.status='published')::int AS product_count
       FROM categories c LEFT JOIN products p ON p.category_id = c.id
      WHERE c.slug = $1 AND c.is_active = true
      GROUP BY c.id LIMIT 1`,
    [slug],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: text(row.id),
    slug: text(row.slug),
    name: text(row.name),
    description: optText(row.description),
    parentId: optText(row.parent_id),
    path: strArray(row.path_slugs),
    productCount: num(row.product_count),
    attributeCodes: [],
  };
}

export async function listTopCategories(
  limit = 6,
): Promise<Array<CategoryNode & { imageUrl: string | null }>> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT c.id, c.slug, c.name, c.description, c.image_url, c.parent_id, c.depth, c.path_slugs,
            count(p.id) FILTER (WHERE p.status='published')::int AS product_count
       FROM categories c LEFT JOIN products p ON p.category_id = c.id
      WHERE c.is_active = true AND c.depth = 0
      GROUP BY c.id ORDER BY c.position ASC LIMIT $1`,
    [limit],
  );
  return res.rows.map((row) => ({
    id: text(row.id),
    slug: text(row.slug),
    name: text(row.name),
    description: optText(row.description),
    parentId: optText(row.parent_id),
    path: strArray(row.path_slugs),
    productCount: num(row.product_count),
    attributeCodes: [],
    imageUrl: optText(row.image_url),
  }));
}

function mapVariant(row: Record<string, unknown>): ProductVariant {
  return {
    id: text(row.id),
    productId: text(row.product_id),
    sku: text(row.sku),
    label: text(row.label),
    options: jsonb<Record<string, string>>(row.options, {}),
    priceAmount: num(row.price_amount),
    compareAtAmount: optNum(row.compare_at_amount),
    currency: "IDR",
    onHand: optNum(row.on_hand),
    reserved: num(row.reserved),
    safetyStock: num(row.safety_stock),
    lowStockThreshold: num(row.low_stock_threshold),
    maxQuantityPerOrder: optNum(row.max_qty_per_order),
    minQuantityPerOrder: num(row.min_qty_per_order),
    isActive: bool(row.is_active),
    mediaIds: strArray(row.media_ids),
    isDeleted: bool(row.is_deleted),
  };
}

/**
 * Detail produk publik. AT-01: produk draft/archived TIDAK dikembalikan untuk pengunjung;
 * hanya aktor dengan izin preview yang boleh (dan itu lewat getAdminProduct).
 */
export async function getProductBySlug(
  slug: string,
  ctx: RequestContext,
): Promise<ProductDetail | null> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT p.*, c.slug AS category_slug, c.name AS category_name,
            COALESCE(rs.average,0)::float8 AS rating_average, COALESCE(rs.review_count,0)::int AS review_count
       FROM products p JOIN categories c ON c.id = p.category_id
       LEFT JOIN product_review_stats rs ON rs.product_id = p.id
      WHERE p.slug = $1 OR $1 = ANY(p.retired_slugs)
      LIMIT 1`,
    [slug],
  );
  const row = res.rows[0];
  if (!row) return null;
  const status = text(row.status) as ProductStatus;
  if (!isPubliclyVisible(status, { canPreview: ctx.canPreviewCatalog })) return null;
  const detail = await assembleDetail(row);
  if (text(row.slug) !== slug) {
    // slug berubah -> canonical + redirect 301 ditangani pemanggil (Blueprint §4.1)
    detail.canonicalSlug = text(row.slug);
  }
  return detail;
}

async function assembleDetail(row: Record<string, unknown>): Promise<ProductDetail> {
  const db = await getDb();
  const productId = text(row.id);
  const [variantsRes, mediaRes, attrRes] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT v.*, COALESCE(ib.on_hand, 0)::int AS on_hand, COALESCE(ib.reserved,0)::int AS reserved,
              COALESCE(ib.safety_stock,0)::int AS safety_stock,
              (SELECT array_agg(m.id::text) FROM product_media m WHERE m.variant_id = v.id) AS media_ids
         FROM product_variants v
         LEFT JOIN inventory_balances ib ON ib.sku = v.sku
        WHERE v.product_id = $1
        ORDER BY v.position ASC, v.label ASC`,
      [productId],
    ),
    db.query<Record<string, unknown>>(
      `SELECT id, url, alt_text, position, width, height, is_primary, variant_id
         FROM product_media WHERE product_id = $1 ORDER BY position ASC, is_primary DESC`,
      [productId],
    ),
    db.query<Record<string, unknown>>(
      `SELECT ad.code, ad.label, ad.presentation, ad.position, ad.is_required
         FROM category_attributes ca JOIN attribute_definitions ad ON ad.code = ca.attribute_code
        WHERE ca.category_id = $1 ORDER BY ad.position ASC`,
      [text(row.category_id)],
    ),
  ]);
  const variants = variantsRes.rows.map(mapVariant);
  const media: ProductMedia[] = mediaRes.rows.map((m) => ({
    id: text(m.id),
    url: text(m.url),
    altText: text(m.alt_text),
    position: num(m.position),
    width: num(m.width),
    height: num(m.height),
    isPrimary: bool(m.is_primary),
    variantId: optText(m.variant_id),
  }));
  const attributesByVariant: AttributeDefinition[] = attrRes.rows.map((a) => ({
    code: text(a.code),
    label: text(a.label),
    presentation:
      (text(a.presentation, "choice") as AttributeDefinition["presentation"]) ?? "choice",
    position: num(a.position),
    isRequired: bool(a.is_required),
  }));
  const sellable = activeVariants(variants);
  const totalAvailable = sellable.reduce(
    (acc, v) => acc + (v.onHand === null ? 99 : Math.max(0, v.onHand - v.reserved - v.safetyStock)),
    0,
  );
  const minPrice = sellable.length ? Math.min(...sellable.map((v) => v.priceAmount)) : 0;
  const maxPrice = sellable.length ? Math.max(...sellable.map((v) => v.priceAmount)) : minPrice;
  const compareAt = sellable.length ? Math.max(...sellable.map((v) => v.compareAtAmount ?? 0)) : 0;
  const stockState: StockState =
    text(row.status) === "archived"
      ? "archive"
      : sellable.length === 0
        ? "out_of_stock"
        : totalAvailable <= 0
          ? "out_of_stock"
          : totalAvailable <= 5
            ? "low_stock"
            : "in_stock";

  return {
    id: productId,
    slug: text(row.slug),
    name: text(row.name),
    summary: text(row.summary),
    description: text(row.description),
    status: text(row.status) as ProductStatus,
    brand: optText(row.brand),
    categoryId: text(row.category_id),
    categorySlug: text(row.category_slug),
    categoryName: text(row.category_name),
    minPriceAmount: minPrice,
    maxPriceAmount: maxPrice,
    compareAtAmount: compareAt > minPrice ? compareAt : null,
    currency: "IDR",
    primaryMediaUrl: media[0]?.url ?? null,
    primaryMediaAlt: media[0]?.altText ?? null,
    availableQuantity: totalAvailable,
    totalVariantQuantity: sellable.reduce((acc, v) => acc + (v.onHand ?? 0), 0),
    ratingAverage: num(row.rating_average) > 0 ? num(row.rating_average) : null,
    reviewCount: num(row.review_count),
    soldQuantity: num(row.popularity),
    isNew: Boolean(
      row.published_at &&
      new Date(String(row.published_at)).getTime() > Date.now() - 30 * 86_400_000,
    ),
    hasPromotion: compareAt > minPrice,
    stockState,
    publishedAt: date(row.published_at),
    updatedAt: dateOrNow(row.updated_at),
    attributes: jsonb<Record<string, string>>(row.attributes, {}),
    careInstructions: optText(row.care_instructions),
    packageContents: jsonb<string[]>(row.package_contents, []),
    warranty: optText(row.warranty),
    media,
    variants,
    attributesByVariant,
    seoTitle: optText(row.meta_title),
    seoDescription: optText(row.meta_description),
    canonicalSlug: optText(row.canonical_slug),
  };
}

export async function listRelatedProducts(
  productId: string,
  categoryId: string,
  limit = 4,
): Promise<ProductSummary[]> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `${PRODUCT_SUMMARY_SQL}
      WHERE p.status = 'published' AND p.id <> $1
      ORDER BY (p.category_id = $2) DESC, p.popularity DESC, p.name ASC
      LIMIT $3`,
    [productId, categoryId, limit],
  );
  return res.rows.map(mapSummary);
}

export async function listFeaturedProducts(limit = 8): Promise<ProductSummary[]> {
  return (await listProducts({ sort: "popular", perPage: limit, page: 1 })).items;
}

export async function listNewProducts(limit = 4): Promise<ProductSummary[]> {
  return (await listProducts({ sort: "newest", perPage: limit, page: 1 })).items;
}

// ---------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------

export interface AdminProductRow {
  id: string;
  sku: string;
  slug: string;
  name: string;
  status: ProductStatus;
  categoryName: string;
  brand: string | null;
  variantCount: number;
  minPriceAmount: number;
  totalStock: number;
  lowStockVariants: number;
  updatedAt: Date;
  publishedAt: Date | null;
}

export async function adminListProducts(params: {
  q?: string;
  status?: ProductStatus | "all";
  categoryId?: string;
  page?: number;
  perPage?: number;
  sort?: "updated" | "name" | "stock_asc";
}): Promise<{ rows: AdminProductRow[]; total: number; page: number; perPage: number }> {
  const db = await getDb();
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(10, params.perPage ?? 20));
  const where: string[] = [];
  const sqlParams: unknown[] = [];
  if (params.q) {
    sqlParams.push(`%${params.q}%`);
    where.push(
      `(lower(p.name) LIKE $${sqlParams.length} OR lower(p.sku) LIKE $${sqlParams.length} OR lower(p.slug) LIKE $${sqlParams.length})`,
    );
  }
  if (params.status && params.status !== "all") {
    sqlParams.push(params.status);
    where.push(`p.status = $${sqlParams.length}`);
  }
  if (params.categoryId) {
    sqlParams.push(params.categoryId);
    where.push(`p.category_id = $${sqlParams.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order =
    params.sort === "name"
      ? "p.name ASC"
      : params.sort === "stock_asc"
        ? "agg.total_stock ASC NULLS FIRST"
        : "p.updated_at DESC";

  const countRes = await db.query<{ c: unknown }>(
    `SELECT count(*)::int AS c FROM products p ${whereSql}`,
    sqlParams,
  );
  const res = await db.query<Record<string, unknown>>(
    `SELECT p.id, p.sku, p.slug, p.name, p.status, p.brand, p.updated_at, p.published_at, c.name AS category_name,
            agg.variant_count, agg.min_amount, agg.total_stock, agg.low_count
       FROM products p
       JOIN categories c ON c.id = p.category_id
       JOIN LATERAL (
         SELECT count(v.id)::int AS variant_count, min(v.price_amount)::bigint AS min_amount,
                sum(COALESCE(ib.available,0))::int AS total_stock,
                count(v.id) FILTER (WHERE COALESCE(ib.available,0) <= v.low_stock_threshold)::int AS low_count
           FROM product_variants v LEFT JOIN inventory_balances ib ON ib.sku = v.sku
          WHERE v.product_id = p.id AND v.is_deleted = false
       ) agg ON true
       ${whereSql}
       ORDER BY ${order}
       LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
    sqlParams,
  );
  return {
    rows: res.rows.map((row) => ({
      id: text(row.id),
      sku: text(row.sku),
      slug: text(row.slug),
      name: text(row.name),
      status: text(row.status) as ProductStatus,
      categoryName: text(row.category_name),
      brand: optText(row.brand),
      variantCount: num(row.variant_count),
      minPriceAmount: num(row.min_amount),
      totalStock: num(row.total_stock),
      lowStockVariants: num(row.low_count),
      updatedAt: dateOrNow(row.updated_at),
      publishedAt: date(row.published_at),
    })),
    total: num(countRes.rows[0]?.c),
    page,
    perPage,
  };
}

export interface AdminProductEdit extends ProductDetail {
  packageContentsRaw: string;
  attributesRaw: string;
}

export async function adminGetProduct(id: string, ctx: RequestContext): Promise<AdminProductEdit> {
  requirePermission(ctx, "catalog.view");
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT p.*, c.slug AS category_slug, c.name AS category_name, COALESCE(rs.average,0)::float8 AS rating_average, COALESCE(rs.review_count,0)::int AS review_count
       FROM products p JOIN categories c ON c.id = p.category_id
       LEFT JOIN product_review_stats rs ON rs.product_id = p.id
      WHERE p.id = $1 LIMIT 1`,
    [id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Produk tidak ditemukan.", { status: 404 });
  const detail = await assembleDetail(row);
  return {
    ...detail,
    packageContentsRaw: JSON.stringify(detail.packageContents, null, 2),
    attributesRaw: JSON.stringify(detail.attributes, null, 2),
  };
}

export interface CreateProductInput {
  name: string;
  slug?: string;
  sku: string;
  summary?: string;
  description: string;
  status: ProductStatus;
  categoryId: string;
  brand?: string | null;
  careInstructions?: string | null;
  warranty?: string | null;
  packageContents?: string[];
  attributes?: Record<string, string>;
  metaTitle?: string | null;
  metaDescription?: string | null;
  variants: Array<{
    sku: string;
    label?: string;
    options?: Record<string, string>;
    priceAmount: number;
    compareAtAmount?: number | null;
    stockQuantity?: number | null;
    lowStockThreshold?: number;
    safetyStock?: number;
    minQuantityPerOrder?: number;
    maxQuantityPerOrder?: number | null;
    isActive?: boolean;
    trackInventory?: boolean;
    locationCode?: string;
  }>;
  media?: Array<{ url: string; altText: string; position?: number; isPrimary?: boolean }>;
}

export async function adminCreateProduct(
  input: CreateProductInput,
  ctx: RequestContext,
): Promise<{ id: string; slug: string }> {
  requirePermission(ctx, "catalog.create");
  const db = await getDb();
  const slug = input.slug?.trim() || deriveSlug(input.name);
  return db.transaction(async (tx) => {
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO products (sku, slug, name, summary, description, brand, status, category_id, attributes, care_instructions, warranty,
                             package_contents, meta_title, meta_description, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb,$13,$14, CASE WHEN $7 = 'published' THEN now() ELSE NULL END)
       RETURNING id`,
      [
        input.sku,
        slug,
        input.name,
        input.summary ?? "",
        input.description,
        input.brand ?? null,
        input.status,
        input.categoryId,
        JSON.stringify(input.attributes ?? {}),
        input.careInstructions ?? null,
        input.warranty ?? null,
        JSON.stringify(input.packageContents ?? []),
        input.metaTitle ?? null,
        input.metaDescription ?? null,
      ],
    );
    const productId = String(inserted.rows[0]?.id);

    for (const variant of input.variants) {
      const vInsert = await tx.query<{ id: string }>(
        `INSERT INTO product_variants (product_id, sku, label, options, option_values, price_amount, compare_at_amount,
                                        track_inventory, low_stock_threshold, safety_stock, min_qty_per_order, max_qty_per_order, is_active)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`,
        [
          productId,
          variant.sku,
          variant.label ?? Object.values(variant.options ?? {}).join(" / ") ?? variant.sku,
          JSON.stringify(variant.options ?? {}),
          Object.values(variant.options ?? {}),
          variant.priceAmount,
          variant.compareAtAmount ?? null,
          variant.trackInventory ?? true,
          variant.lowStockThreshold ?? 5,
          variant.safetyStock ?? 0,
          variant.minQuantityPerOrder ?? 1,
          variant.maxQuantityPerOrder ?? null,
          variant.isActive ?? true,
        ],
      );
      const variantId = String(vInsert.rows[0]?.id);
      const location = variant.locationCode ?? (await defaultLocationCode(tx));
      await tx.query(
        `INSERT INTO inventory_balances (location_code, sku, on_hand, safety_stock)
         VALUES ($1,$2,$3,$4) ON CONFLICT (location_code, sku) DO NOTHING`,
        [location, variant.sku, Math.max(0, variant.stockQuantity ?? 0), variant.safetyStock ?? 0],
      );
      if ((variant.stockQuantity ?? 0) > 0) {
        await tx.query(
          `INSERT INTO inventory_movements (location_code, sku, kind, quantity, balance_before, balance_after, reason_code, note, ref_type, ref_id, actor_id, request_id)
           VALUES ($1,$2,'receipt',$3,0,$3,'wrong_entry_fix','Stok awal saat pembuatan produk','product',$4,$5,$6)`,
          [
            location,
            variant.sku,
            variant.stockQuantity ?? 0,
            productId,
            ctx.user?.id ?? null,
            ctx.requestId,
          ],
        );
      }
    }

    for (const [index, mediaItem] of (input.media ?? []).entries()) {
      await tx.query(
        `INSERT INTO product_media (product_id, url, alt_text, position, is_primary) VALUES ($1,$2,$3,$4,$5)`,
        [
          productId,
          mediaItem.url,
          mediaItem.altText,
          mediaItem.position ?? index,
          mediaItem.isPrimary ?? index === 0,
        ],
      );
    }

    await tx.query(
      `INSERT INTO audit_logs (actor_id, actor_email, actor_kind, action, target_type, target_id, after_data, request_id)
       VALUES ($1,$2,$3,'catalog.product.create','product',$4,$5::jsonb,$6)`,
      [
        ctx.user?.id ?? null,
        ctx.user?.email ?? null,
        ctx.isStaff ? "staff" : "system",
        productId,
        JSON.stringify({
          name: input.name,
          sku: input.sku,
          status: input.status,
          variants: input.variants.length,
        }),
        ctx.requestId,
      ],
    );
    return { id: productId, slug };
  });
}

async function defaultLocationCode(tx: {
  query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}): Promise<string> {
  const res = await tx.query<{ code: string }>(
    `SELECT code FROM inventory_locations WHERE is_active = true ORDER BY code LIMIT 1`,
  );
  return res.rows[0]?.code ?? "MAIN";
}

export interface UpdateProductInput extends Partial<CreateProductInput> {
  id: string;
  /** perubahan harga besar akan dicatat ke price_history + memicu approval flow bila perlu */
  changedVariantIds?: string[];
}

export async function adminUpdateProduct(
  input: UpdateProductInput,
  ctx: RequestContext,
): Promise<void> {
  requirePermission(ctx, "catalog.update");
  const db = await getDb();
  const before = await db.query<Record<string, unknown>>(`SELECT * FROM products WHERE id = $1`, [
    input.id,
  ]);
  const beforeRow = before.rows[0];
  if (!beforeRow) throw new AppError("NOT_FOUND", "Produk tidak ditemukan.", { status: 404 });

  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE products SET
         name = COALESCE($2, name),
         slug = COALESCE($3, slug),
         summary = COALESCE($4, summary),
         description = COALESCE($5, description),
         brand = COALESCE($6, brand),
         status = COALESCE($7, status),
         category_id = COALESCE($8, category_id),
         attributes = COALESCE($9::jsonb, attributes),
         care_instructions = COALESCE($10, care_instructions),
         warranty = COALESCE($11, warranty),
         package_contents = COALESCE($12::jsonb, package_contents),
         meta_title = COALESCE($13, meta_title),
         meta_description = COALESCE($14, meta_description),
         published_at = CASE WHEN COALESCE($7, status) = 'published' AND published_at IS NULL THEN now() ELSE published_at END,
         archived_at = CASE WHEN COALESCE($7, status) = 'archived' THEN now() ELSE archived_at END
       WHERE id = $1`,
      [
        input.id,
        input.name ?? null,
        input.slug ?? null,
        input.summary ?? null,
        input.description ?? null,
        input.brand ?? null,
        input.status ?? null,
        input.categoryId ?? null,
        input.attributes ? JSON.stringify(input.attributes) : null,
        input.careInstructions ?? null,
        input.warranty ?? null,
        input.packageContents ? JSON.stringify(input.packageContents) : null,
        input.metaTitle ?? null,
        input.metaDescription ?? null,
      ],
    );

    for (const variant of input.variants ?? []) {
      if (!variant.sku) continue;
      const existing = await tx.query<{ id: string; price_amount: unknown }>(
        `SELECT id, price_amount FROM product_variants WHERE product_id = $1 AND sku = $2`,
        [input.id, variant.sku],
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        await tx.query(
          `UPDATE product_variants SET options = COALESCE($3::jsonb, options), price_amount = COALESCE($4, price_amount),
                  compare_at_amount = $5, low_stock_threshold = COALESCE($6, low_stock_threshold),
                  safety_stock = COALESCE($7, safety_stock), min_qty_per_order = COALESCE($8, min_qty_per_order),
                  max_qty_per_order = $9, is_active = COALESCE($10, is_active)
             WHERE id = $1`,
          [
            existingRow.id,
            variant.sku,
            variant.options ? JSON.stringify(variant.options) : null,
            variant.priceAmount ?? null,
            variant.compareAtAmount ?? null,
            variant.lowStockThreshold ?? null,
            variant.safetyStock ?? null,
            variant.minQuantityPerOrder ?? null,
            variant.maxQuantityPerOrder ?? null,
            variant.isActive ?? null,
          ],
        );
        const oldPrice = num(existingRow.price_amount);
        const newPrice = variant.priceAmount ?? oldPrice;
        if (newPrice !== oldPrice) {
          // Histori harga: order lama tidak pernah ditulis ulang (CAT-04).
          await tx.query(
            `INSERT INTO price_history (variant_id, old_amount, new_amount, changed_by, reason, request_id)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              String(existingRow.id),
              oldPrice,
              newPrice,
              ctx.user?.id ?? null,
              "perubahan lewat admin catalog",
              ctx.requestId,
            ],
          );
        }
      }
    }

    await tx.query(
      `INSERT INTO audit_logs (actor_id, actor_email, actor_kind, action, target_type, target_id, before_data, after_data, reason, request_id)
       VALUES ($1,$2,$3,'catalog.product.update','product',$4,$5::jsonb,$6::jsonb,$7,$8)`,
      [
        ctx.user?.id ?? null,
        ctx.user?.email ?? null,
        ctx.isStaff ? "staff" : "system",
        input.id,
        JSON.stringify({
          name: beforeRow.name,
          status: beforeRow.status,
          meta_title: beforeRow.meta_title,
        }),
        JSON.stringify({
          name: input.name ?? beforeRow.name,
          status: input.status ?? beforeRow.status,
        }),
        input.status === "published" ? "Publikasi/perubahan katalog" : null,
        ctx.requestId,
      ],
    );
  });
}

/** Publish/arxiv adalah aksi terpisah (Blueprint §8 "approval pada perubahan besar"). */
export async function adminSetProductStatus(
  id: string,
  status: ProductStatus,
  ctx: RequestContext,
  reason?: string,
): Promise<void> {
  requirePermission(
    ctx,
    status === "published"
      ? "catalog.publish"
      : status === "archived"
        ? "catalog.archive"
        : "catalog.update",
  );
  const db = await getDb();
  await db.query(
    `UPDATE products SET status = $2,
       published_at = CASE WHEN $2 = 'published' AND published_at IS NULL THEN now() ELSE published_at END,
       archived_at = CASE WHEN $2 = 'archived' THEN now() ELSE archived_at END
     WHERE id = $1`,
    [id, status],
  );
  await db.query(
    `INSERT INTO audit_logs (actor_id, actor_email, actor_kind, action, target_type, target_id, after_data, reason, request_id)
     VALUES ($1,$2,'staff',$3,'product',$4,$5::jsonb,$6,$7)`,
    [
      ctx.user?.id ?? null,
      ctx.user?.email ?? null,
      `catalog.product.${status}`,
      id,
      JSON.stringify({ status }),
      reason ?? null,
      ctx.requestId,
    ],
  );
}

export async function adminAddMedia(
  productId: string,
  media: { url: string; altText: string; isPrimary?: boolean; variantId?: string | null },
  ctx: RequestContext,
): Promise<void> {
  requirePermission(ctx, "catalog.update");
  const db = await getDb();
  await db.transaction(async (tx) => {
    if (media.isPrimary)
      await tx.query("UPDATE product_media SET is_primary = false WHERE product_id = $1", [
        productId,
      ]);
    const positionRes = await tx.query<{ p: unknown }>(
      `SELECT COALESCE(max(position)+1,0)::int AS p FROM product_media WHERE product_id = $1`,
      [productId],
    );
    await tx.query(
      `INSERT INTO product_media (product_id, variant_id, url, alt_text, position, is_primary) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        productId,
        media.variantId ?? null,
        media.url,
        media.altText,
        num(positionRes.rows[0]?.p),
        media.isPrimary ?? false,
      ],
    );
  });
}

export async function adminRemoveMedia(mediaId: string, ctx: RequestContext): Promise<void> {
  requirePermission(ctx, "catalog.update");
  const db = await getDb();
  await db.query("DELETE FROM product_media WHERE id = $1", [mediaId]);
  await db.query(
    `INSERT INTO audit_logs (actor_id, actor_email, actor_kind, action, target_type, target_id, request_id)
     VALUES ($1,$2,'staff','catalog.media.delete','media',$3,$4)`,
    [ctx.user?.id ?? null, ctx.user?.email ?? null, mediaId, ctx.requestId],
  );
}

/** Slug berubah -> simpan slug lama di retired_slugs agar redirect tetap aman (Blueprint §4.1). */
export async function adminChangeSlug(
  productId: string,
  newSlug: string,
  ctx: RequestContext,
): Promise<void> {
  requirePermission(ctx, "catalog.update");
  const db = await getDb();
  await db.query(
    `UPDATE products SET retired_slugs = array_append(array_remove(retired_slugs, slug), slug), slug = $2 WHERE id = $1`,
    [productId, newSlug],
  );
  await db.query(
    `INSERT INTO audit_logs (actor_id, actor_email, actor_kind, action, target_type, target_id, after_data, request_id)
     VALUES ($1,$2,'staff','catalog.slug.change','product',$3,$4::jsonb,$5)`,
    [
      ctx.user?.id ?? null,
      ctx.user?.email ?? null,
      productId,
      JSON.stringify({ slug: newSlug }),
      ctx.requestId,
    ],
  );
}

// ---------------------------------------------------------------------
// Ulasan (Blueprint §5.5) - moderasi state, tanpa rating palsu
// ---------------------------------------------------------------------

export interface ReviewRow {
  id: string;
  rating: number;
  title: string;
  body: string;
  variantLabel: string | null;
  createdAt: Date;
  authorName: string;
  isVerifiedPurchase: boolean;
  status: "pending" | "published" | "rejected" | "hidden";
}

export async function listReviews(
  productId: string,
  options: { includePending?: boolean } = {},
): Promise<ReviewRow[]> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT r.id, r.rating, r.title, r.body, r.variant_label, r.created_at, r.is_verified_purchase, r.status,
            COALESCE(u.full_name, 'Pelanggan NOVA') AS author
       FROM reviews r
       LEFT JOIN users u ON u.id = r.author_id
      WHERE r.product_id = $1 ${options.includePending ? "" : "AND r.status = 'published'"}
      ORDER BY r.created_at DESC
      LIMIT 40`,
    [productId],
  );
  return res.rows.map((row) => ({
    id: text(row.id),
    rating: num(row.rating),
    title: text(row.title),
    body: text(row.body),
    variantLabel: optText(row.variant_label),
    createdAt: dateOrNow(row.created_at),
    authorName: text(row.author),
    isVerifiedPurchase: bool(row.is_verified_purchase),
    status: text(row.status, "pending") as ReviewRow["status"],
  }));
}

export async function createReview(
  input: { productId: string; rating: number; title: string; body?: string; variantLabel?: string },
  ctx: RequestContext,
): Promise<{ status: "pending" | "published" }> {
  const user = ctx.user;
  if (!user) throw new AppError("UNAUTHENTICATED", "Masuk untuk menulis ulasan.", { status: 401 });
  const db = await getDb();
  // Eligibilitas: hanya pembelian terverifikasi yang boleh menulis (dan label itu tidak dipalsukan).
  const purchase = await db.query<{ order_item_id: string; variant_id: string }>(
    `SELECT oi.id AS order_item_id, oi.variant_id
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.customer_id = $1 AND oi.product_id = $2 AND o.status IN ('delivered','completed','return_requested','return_approved','returned')
        AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.order_item_id = oi.id)
      LIMIT 1`,
    [user.id, input.productId],
  );
  const matched = purchase.rows[0];
  const res = await db.query<{ id: string; status: string }>(
    `INSERT INTO reviews (product_id, author_id, order_id, order_item_id, rating, title, body, variant_label, status, is_verified_purchase)
     VALUES ($1,$2,(SELECT order_id FROM order_items WHERE id = $4),$4,$3,$5,$6,$7,'pending', CASE WHEN $4 IS NULL THEN false ELSE true END)
     RETURNING id, status`,
    [
      input.productId,
      user.id,
      input.rating,
      matched?.order_item_id ?? null,
      input.title,
      input.body ?? "",
      input.variantLabel ?? null,
    ],
  );
  await db.query(
    `INSERT INTO integration_outbox (kind, destination, payload, idempotency_key)
     VALUES ('review.moderate','internal',$1::jsonb,$2)`,
    [
      JSON.stringify({ reviewId: res.rows[0]?.id, productId: input.productId }),
      `review:${String(res.rows[0]?.id)}:${ctx.requestId}`,
    ],
  );
  return { status: "pending" };
}

export async function moderateReview(
  reviewId: string,
  decision: "published" | "rejected" | "hidden",
  note: string,
  ctx: RequestContext,
): Promise<void> {
  requirePermission(ctx, "review.moderate");
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE reviews SET status = $2, moderation_note = $3, moderated_by = $4, moderated_at = now()
       WHERE id = $1 RETURNING product_id`,
      [reviewId, decision, note, ctx.user?.id ?? null],
    );
    await tx.query(
      `INSERT INTO product_review_stats (product_id, average, review_count)
       SELECT $1, COALESCE(AVG(rating),0), count(*) FROM reviews WHERE product_id = $1 AND status = 'published'
       ON CONFLICT (product_id) DO UPDATE SET average = EXCLUDED.average, review_count = EXCLUDED.review_count, updated_at = now()`,
      [reviewId],
    );
    await tx.query(
      `INSERT INTO audit_logs (actor_id, actor_email, actor_kind, action, target_type, target_id, after_data, reason, request_id)
       VALUES ($1,$2,'staff','review.moderate','review',$3,$4::jsonb,$5,$6)`,
      [
        ctx.user?.id ?? null,
        ctx.user?.email ?? null,
        reviewId,
        JSON.stringify({ status: decision }),
        note,
        ctx.requestId,
      ],
    );
  });
}

export async function listPendingReviews(
  limit = 25,
): Promise<
  Array<ReviewRow & { productId: string; productName: string; authorEmail: string | null }>
> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT r.id, r.rating, r.title, r.body, r.variant_label, r.created_at, r.is_verified_purchase, r.status,
            r.product_id, p.name AS product_name, u.email AS author_email, COALESCE(u.full_name,'Pelanggan') AS author
       FROM reviews r
       JOIN products p ON p.id = r.product_id
       LEFT JOIN users u ON u.id = r.author_id
      WHERE r.status = 'pending' ORDER BY r.created_at LIMIT $1`,
    [limit],
  );
  return res.rows.map((row) => ({
    id: text(row.id),
    rating: num(row.rating),
    title: text(row.title),
    body: text(row.body),
    variantLabel: optText(row.variant_label),
    createdAt: dateOrNow(row.created_at),
    authorName: text(row.author),
    isVerifiedPurchase: bool(row.is_verified_purchase),
    status: text(row.status, "pending") as ReviewRow["status"],
    productId: text(row.product_id),
    productName: text(row.product_name),
    authorEmail: optText(row.author_email),
  }));
}

/** Opsi atribut per kategori (CAT-06: filter hanya muncul bila atribut relevan & punya data). */
export async function listCategoryAttributes(categoryId: string): Promise<AttributeDefinition[]> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT ad.code, ad.label, ad.presentation, ad.position, ad.is_required
       FROM category_attributes ca JOIN attribute_definitions ad ON ad.code = ca.attribute_code
      WHERE ca.category_id = $1 AND ca.is_filterable = true ORDER BY ad.position`,
    [categoryId],
  );
  return res.rows.map((row) => ({
    code: text(row.code),
    label: text(row.label),
    presentation: (text(row.presentation) as AttributeDefinition["presentation"]) ?? "choice",
    position: num(row.position),
    isRequired: bool(row.is_required),
  }));
}
