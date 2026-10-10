import "server-only";
import { AppError } from "@/domain/errors";
import { addressSchema, parseOrThrow } from "@/domain/validation";
import { getDb, bool, date, jsonb, num, optText, text } from "@/platform/db";
import { writeAudit } from "@/platform/audit";
import { generateReference } from "@/domain/ids";
import { requireUser } from "@/server/context";
import type { RequestContext } from "@/server/context";

/** Akun pelanggan (Blueprint §7.2, §10.4): profil, alamat, wishlist, hak privasi PDP. */

export interface AccountProfile {
  fullName: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  memberSince: Date | null;
  marketingConsent: boolean;
  consentUpdatedAt: Date | null;
  locale: string;
  timezone: string;
  addressCount: number;
  orderCount: number;
  openReturns: number;
  wishlistCount: number;
}

export async function getProfile(ctx: RequestContext): Promise<AccountProfile> {
  const user = requireUser(ctx);
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT u.full_name, u.email, u.phone, u.email_verified_at, u.created_at,
            cp.marketing_consent, cp.consent_updated_at, cp.locale, cp.timezone,
            (SELECT count(*)::int FROM addresses a WHERE a.user_id = u.id AND a.is_deleted = false) AS address_count,
            (SELECT count(*)::int FROM orders o WHERE o.customer_id = u.id) AS order_count,
            (SELECT count(*)::int FROM returns r WHERE r.customer_id = u.id AND r.status NOT IN ('resolved','rejected','cancelled')) AS open_returns,
            (SELECT count(*)::int FROM wishlist_items wi JOIN wishlists w ON w.id = wi.wishlist_id WHERE w.user_id = u.id) AS wishlist_count
       FROM users u LEFT JOIN customer_profiles cp ON cp.user_id = u.id
      WHERE u.id = $1`,
    [user.id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Profil tidak ditemukan.", { status: 404 });
  return {
    fullName: text(row.full_name),
    email: text(row.email),
    phone: optText(row.phone),
    emailVerified: Boolean(row.email_verified_at),
    memberSince: date(row.created_at),
    marketingConsent: bool(row.marketing_consent),
    consentUpdatedAt: date(row.consent_updated_at),
    locale: text(row.locale, "id-ID"),
    timezone: text(row.timezone, "Asia/Jakarta"),
    addressCount: num(row.address_count),
    orderCount: num(row.order_count),
    openReturns: num(row.open_returns),
    wishlistCount: num(row.wishlist_count),
  };
}

export async function updateProfile(
  ctx: RequestContext,
  input: { fullName?: string; phone?: string; marketingConsent?: boolean },
): Promise<{ message: string }> {
  const user = requireUser(ctx);
  const db = await getDb();
  if (input.fullName !== undefined && input.fullName.trim().length < 3) {
    throw new AppError("VALIDATION_FAILED", "Nama minimal 3 karakter.", { status: 422 });
  }
  const before = await db.query<Record<string, unknown>>(
    `SELECT u.full_name, u.phone, cp.marketing_consent FROM users u LEFT JOIN customer_profiles cp ON cp.user_id = u.id WHERE u.id = $1`,
    [user.id],
  );
  await db.transaction(async (tx) => {
    if (input.fullName !== undefined || input.phone !== undefined) {
      await tx.query(
        `UPDATE users SET full_name = COALESCE($2, full_name), phone = COALESCE($3, phone), updated_at = now() WHERE id = $1`,
        [user.id, input.fullName?.trim() ?? null, input.phone?.trim() ?? null],
      );
    }
    if (input.marketingConsent !== undefined) {
      await tx.query(
        `UPDATE customer_profiles SET marketing_consent = $2, consent_updated_at = now(), updated_at = now() WHERE user_id = $1`,
        [user.id, input.marketingConsent],
      );
      await tx.query(
        `INSERT INTO consent_records (user_id, email, purpose, policy_key, policy_version, source, request_id)
         SELECT $1, email, 'marketing', 'privasi', 'privasi-v1', 'account', $2 FROM users WHERE id = $1`,
        [user.id, ctx.requestId],
      );
    }
  });
  await writeAudit({
    actorId: user.id,
    actorEmail: user.email,
    actorKind: "customer",
    action: "account.profile_update",
    targetType: "user",
    targetId: user.id,
    beforeData: { marketingConsent: bool(before.rows[0]?.marketing_consent) },
    afterData: {
      marketingConsent: input.marketingConsent ?? bool(before.rows[0]?.marketing_consent),
      fields: Object.keys(input),
    },
    requestId: ctx.requestId,
  });
  return {
    message:
      input.marketingConsent === false
        ? "Preferensi disimpan. Email promosi akan dihentikan."
        : "Profil diperbarui.",
  };
}

// ---------------------------------------------------------------------
// Alamat
// ---------------------------------------------------------------------

export interface AddressRow {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  postalCode: string;
  street: string;
  landmark: string | null;
  isDefault: boolean;
}

function mapAddress(row: Record<string, unknown>): AddressRow {
  return {
    id: text(row.id),
    label: text(row.label),
    fullName: text(row.full_name),
    phone: text(row.phone),
    province: text(row.province),
    city: text(row.city),
    district: text(row.district),
    postalCode: text(row.postal_code),
    street: text(row.street),
    landmark: optText(row.landmark),
    isDefault: bool(row.is_default),
  };
}

export async function listAddresses(ctx: RequestContext): Promise<AddressRow[]> {
  const user = requireUser(ctx);
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM addresses WHERE user_id = $1 AND is_deleted = false ORDER BY is_default DESC, created_at ASC`,
    [user.id],
  );
  return res.rows.map(mapAddress);
}

export async function saveAddress(
  ctx: RequestContext,
  input: unknown,
  existingId?: string,
): Promise<{ id: string; message: string }> {
  const user = requireUser(ctx);
  const data = parseOrThrow(addressSchema, input);
  const db = await getDb();
  const count = await db.query<{ c: unknown }>(
    `SELECT count(*)::int AS c FROM addresses WHERE user_id = $1 AND is_deleted = false`,
    [user.id],
  );
  if (!existingId && num(count.rows[0]?.c) >= 20) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Maksimal 20 alamat tersimpan. Hapus alamat lama terlebih dahulu.",
      { status: 422 },
    );
  }
  const id = await db.transaction(async (tx) => {
    if (data.isDefault)
      await tx.query(`UPDATE addresses SET is_default = false WHERE user_id = $1`, [user.id]);
    if (existingId) {
      const res = await tx.query<{ id: string }>(
        `UPDATE addresses SET label=$3, full_name=$4, phone=$5, province=$6, city=$7, district=$8, postal_code=$9, street=$10, landmark=$11, is_default=$12, updated_at=now()
          WHERE id = $1 AND user_id = $2 AND is_deleted = false RETURNING id`,
        [
          existingId,
          user.id,
          data.label ?? "lainnya",
          data.fullName,
          data.phone,
          data.province,
          data.city,
          data.district,
          data.postalCode,
          data.street,
          data.landmark ?? null,
          data.isDefault ?? false,
        ],
      );
      const updated = res.rows[0]?.id;
      if (!updated) throw new AppError("NOT_FOUND", "Alamat tidak ditemukan.", { status: 404 });
      return String(updated);
    }
    const isFirst = num(count.rows[0]?.c) === 0;
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO addresses (user_id, label, full_name, phone, province, city, district, postal_code, street, landmark, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        user.id,
        data.label ?? "lainnya",
        data.fullName,
        data.phone,
        data.province,
        data.city,
        data.district,
        data.postalCode,
        data.street,
        data.landmark ?? null,
        isFirst || Boolean(data.isDefault),
      ],
    );
    return String(inserted.rows[0]?.id);
  });
  await writeAudit({
    actorId: user.id,
    actorEmail: user.email,
    actorKind: "customer",
    action: existingId ? "account.address_update" : "account.address_create",
    targetType: "address",
    targetId: id,
    requestId: ctx.requestId,
  });
  return { id, message: existingId ? "Alamat diperbarui." : "Alamat ditambahkan." };
}

export async function deleteAddress(ctx: RequestContext, id: string): Promise<{ message: string }> {
  const user = requireUser(ctx);
  const db = await getDb();
  const res = await db.query<{ id: string }>(
    `UPDATE addresses SET is_deleted = true, is_default = false, updated_at = now() WHERE id = $1 AND user_id = $2 AND is_deleted = false RETURNING id`,
    [id, user.id],
  );
  if (!res.rows[0]) throw new AppError("NOT_FOUND", "Alamat tidak ditemukan.", { status: 404 });
  await db.query(
    `UPDATE addresses SET is_default = true WHERE user_id = $1 AND is_deleted = false AND id = (SELECT id FROM addresses WHERE user_id = $1 AND is_deleted = false ORDER BY created_at LIMIT 1)`,
    [user.id],
  );
  await writeAudit({
    actorId: user.id,
    actorEmail: user.email,
    actorKind: "customer",
    action: "account.address_delete",
    targetType: "address",
    targetId: id,
    requestId: ctx.requestId,
  });
  return {
    message:
      "Alamat dihapus. Alamat pesanan yang sudah dibuat tidak berubah (menggunakan snapshot).",
  };
}

export async function setDefaultAddress(
  ctx: RequestContext,
  id: string,
): Promise<{ message: string }> {
  const user = requireUser(ctx);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const res = await tx.query<{ id: string }>(
      `SELECT id FROM addresses WHERE id = $1 AND user_id = $2 AND is_deleted = false`,
      [id, user.id],
    );
    if (!res.rows[0]) throw new AppError("NOT_FOUND", "Alamat tidak ditemukan.", { status: 404 });
    await tx.query(`UPDATE addresses SET is_default = false WHERE user_id = $1`, [user.id]);
    await tx.query(`UPDATE addresses SET is_default = true, updated_at = now() WHERE id = $1`, [
      id,
    ]);
  });
  return { message: "Alamat utama diperbarui dan akan dipakai sebagai default saat checkout." };
}

// ---------------------------------------------------------------------
// Wishlist
// ---------------------------------------------------------------------

export async function listWishlist(ctx: RequestContext): Promise<
  Array<{
    productId: string;
    variantId: string | null;
    name: string;
    slug: string;
    priceAmount: number;
    imageUrl: string | null;
    status: string;
    inStock: boolean;
    addedAt: Date | null;
  }>
> {
  const user = requireUser(ctx);
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT wi.product_id, wi.variant_id, wi.created_at, p.name, p.slug, p.status,
            v.price_amount, media.url AS image_url,
            COALESCE(SUM(GREATEST(b.on_hand - b.reserved, 0)), 0)::int AS available
       FROM wishlists w
       JOIN wishlist_items wi ON wi.wishlist_id = w.id
       JOIN products p ON p.id = wi.product_id
       LEFT JOIN product_variants v ON v.id = wi.variant_id
       LEFT JOIN LATERAL (SELECT url FROM product_media m WHERE m.product_id = p.id ORDER BY m.position LIMIT 1) media ON true
       LEFT JOIN product_variants pv ON pv.product_id = p.id
       LEFT JOIN inventory_balances b ON b.sku = pv.sku
      WHERE w.user_id = $1
      GROUP BY wi.product_id, wi.variant_id, wi.created_at, p.name, p.slug, p.status, v.price_amount, media.url
      ORDER BY wi.created_at DESC
      LIMIT 200`,
    [user.id],
  );
  return res.rows.map((row) => ({
    productId: text(row.product_id),
    variantId:
      text(row.variant_id) === "00000000-0000-0000-0000-000000000000" ? null : text(row.variant_id),
    name: text(row.name),
    slug: text(row.slug),
    priceAmount: num(row.price_amount),
    imageUrl: optText(row.image_url),
    status: text(row.status),
    inStock: num(row.available) > 0 && text(row.status) === "published",
    addedAt: date(row.created_at),
  }));
}

const NO_VARIANT = "00000000-0000-0000-0000-000000000000";

export async function toggleWishlist(
  ctx: RequestContext,
  productId: string,
  variantId?: string | null,
): Promise<{ added: boolean; message: string }> {
  const user = requireUser(ctx);
  const db = await getDb();
  const product = await db.query<{ id: string; name: string; status: string }>(
    `SELECT id, name, status FROM products WHERE id = $1`,
    [productId],
  );
  if (!product.rows[0]) throw new AppError("NOT_FOUND", "Produk tidak ditemukan.", { status: 404 });
  const wishlist = await db.transaction(async (tx) => {
    const w = await tx.query<{ id: string }>(
      `SELECT id FROM wishlists WHERE user_id = $1 AND name = 'Wishlist saya'`,
      [user.id],
    );
    const id =
      w.rows[0]?.id ??
      String(
        (
          await tx.query<{ id: string }>(
            `INSERT INTO wishlists (user_id) VALUES ($1) RETURNING id`,
            [user.id],
          )
        ).rows[0]?.id,
      );
    const existing = await tx.query<{ p: unknown }>(
      `SELECT product_id FROM wishlist_items WHERE wishlist_id = $1 AND product_id = $2 AND variant_id = $3`,
      [id, productId, variantId ?? NO_VARIANT],
    );
    if (existing.rows[0]) {
      await tx.query(
        `DELETE FROM wishlist_items WHERE wishlist_id = $1 AND product_id = $2 AND variant_id = $3`,
        [id, productId, variantId ?? NO_VARIANT],
      );
      return { id, removed: true };
    }
    await tx.query(
      `INSERT INTO wishlist_items (wishlist_id, product_id, variant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [id, productId, variantId ?? NO_VARIANT],
    );
    return { id, removed: false };
  });
  return {
    added: !wishlist.removed,
    message: wishlist.removed
      ? `${text(product.rows[0].name)} dihapus dari wishlist.`
      : `${text(product.rows[0].name)} disimpan ke wishlist.`,
  };
}

// ---------------------------------------------------------------------
// Hak privasi (UU PDP / PP 80/2019 - Blueprint §10.4)
// ---------------------------------------------------------------------

export type PrivacyKind = "access" | "correction" | "deletion" | "portability" | "objection";

export const PRIVACY_KIND_LABELS: Record<PrivacyKind, string> = {
  access: "Meminta salinan data pribadi",
  correction: "Memperbaiki data pribadi",
  deletion: "Menghapus data pribadi",
  portability: "Membawa data ke layanan lain",
  objection: "Menolak pemrosesan data",
};

export async function listPrivacyRequests(ctx: RequestContext) {
  const user = requireUser(ctx);
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT id, reference, kind, status, detail, created_at, completed_at FROM privacy_requests WHERE user_id = $1 ORDER BY created_at DESC`,
    [user.id],
  );
  return res.rows.map((row) => ({
    id: text(row.id),
    reference: text(row.reference),
    kind: text(row.kind) as PrivacyKind,
    kindLabel: PRIVACY_KIND_LABELS[text(row.kind) as PrivacyKind] ?? text(row.kind),
    status: text(row.status),
    detail: optText(row.detail),
    createdAt: date(row.created_at),
    completedAt: date(row.completed_at),
  }));
}

export async function createPrivacyRequest(
  ctx: RequestContext,
  input: { kind: PrivacyKind; detail: string },
): Promise<{ reference: string; message: string }> {
  const user = requireUser(ctx);
  if (!PRIVACY_KIND_LABELS[input.kind])
    throw new AppError("VALIDATION_FAILED", "Jenis permintaan tidak dikenali.", { status: 422 });
  if (input.detail.trim().length < 10)
    throw new AppError("VALIDATION_FAILED", "Jelaskan permintaan Anda (minimal 10 karakter).", {
      status: 422,
    });
  const db = await getDb();
  const reference = generateReference("PDP");
  await db.query(
    `INSERT INTO privacy_requests (reference, user_id, email, kind, status, detail) VALUES ($1,$2,$3,$4,'received',$5)`,
    [reference, user.id, user.email, input.kind, input.detail.trim()],
  );
  await writeAudit({
    actorId: user.id,
    actorEmail: user.email,
    actorKind: "customer",
    action: "privacy.request",
    targetType: "privacy_request",
    targetId: reference,
    afterData: { kind: input.kind },
    reason: input.detail.slice(0, 200),
    requestId: ctx.requestId,
  });
  return {
    reference,
    message:
      input.kind === "deletion"
        ? `Permintaan ${reference} diterima. Data transaksi wajib disimpan sesuai ketentuan pembukuan/pajak; yang dapat dihapus adalah data pemasaran dan preferensi. Tim kami akan memverifikasi identitas Anda.`
        : `Permintaan ${reference} diterima. Kami akan memverifikasi identitas Anda dan menindaklanjuti maksimal 14 hari kerja.`,
  };
}

export async function consentOverview(ctx: RequestContext) {
  const user = requireUser(ctx);
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT DISTINCT ON (purpose) purpose, policy_key, policy_version, accepted_at, source
       FROM consent_records WHERE user_id = $1 ORDER BY purpose, accepted_at DESC`,
    [user.id],
  );
  return res.rows.map((row) => ({
    purpose: text(row.purpose),
    policyKey: text(row.policy_key),
    policyVersion: text(row.policy_version),
    acceptedAt: date(row.accepted_at),
    source: text(row.source, "checkout"),
  }));
}

export async function updateMarketingConsent(
  ctx: RequestContext,
  accepted: boolean,
): Promise<{ message: string }> {
  return updateProfile(ctx, { marketingConsent: accepted });
}

export async function wishlistProductIds(ctx: RequestContext): Promise<string[]> {
  if (!ctx.user) return [];
  const db = await getDb();
  const res = await db.query<{ product_id: string }>(
    `SELECT wi.product_id FROM wishlists w JOIN wishlist_items wi ON wi.wishlist_id = w.id WHERE w.user_id = $1`,
    [ctx.user.id],
  );
  return res.rows.map((r) => String(r.product_id));
}

export function addressSnapshotForCheckout(row: Record<string, unknown>) {
  return jsonb<Record<string, unknown>>(row, {});
}
