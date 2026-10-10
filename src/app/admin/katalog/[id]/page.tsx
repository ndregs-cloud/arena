import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PRODUCT_STATUSES, type ProductStatus } from "@/domain/catalog";
import { hasPermission, requireStaffPage } from "@/server/context";
import { adminGetProduct, listCategories } from "@/server/services/catalog.service";
import { formatDateTime, formatIDR } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CheckboxRow, Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { Table, Td, Tr } from "@/components/ui/table";
import { setProductStatusAction, updateProductAction } from "@/app/actions/admin";

export const metadata: Metadata = {
  title: "Admin - kelola produk",
  robots: { index: false, follow: false },
};

export default async function AdminProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pesan?: string; err?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const ctx = await requireStaffPage("/admin/katalog");
  const product = await adminGetProduct(id, ctx).catch(() => null);
  if (!product) notFound();
  const categories = await listCategories();
  const canEdit = hasPermission(ctx, "catalog.update");
  const canPublish = hasPermission(ctx, "catalog.publish");

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-[13px] text-secondary">
        <Link href="/admin/katalog" className="hover:underline">
          Katalog
        </Link>
        <span aria-hidden="true"> › </span>
        <span className="text-ink-soft">{product.name}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] leading-[32px]">{product.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-secondary">
            <Badge tone={product.status === "published" ? "success" : "neutral"}>
              {product.status}
            </Badge>
            <code className="rounded-tile bg-canvas px-1">/produk/{product.slug}</code>
            <span>diperbarui {formatDateTime(product.updatedAt)}</span>
          </p>
        </div>
        <Link
          href={`/produk/${product.slug}`}
          className="min-h-[36px] inline-flex items-center rounded-control border border-border px-3 text-[13px] font-semibold hover:bg-canvas"
        >
          Pratinjau di toko
        </Link>
      </div>

      {query.pesan ? <Alert tone="success">{query.pesan}</Alert> : null}
      {query.err ? <Alert tone="danger">{query.err}</Alert> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader
            title="Konten produk"
            subtitle={
              canEdit
                ? "Perubahan tersimpan setelah tombol ditekan; slug & harga varian diubah dari panel kanan."
                : "Akun ini hanya boleh melihat (tanpa catalog.update)."
            }
          />
          <form action={updateProductAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={product.id} />
            <Field label="Nama" htmlFor="name" required className="sm:col-span-2">
              <TextInput
                id="name"
                name="name"
                defaultValue={product.name}
                required
                disabled={!canEdit}
              />
            </Field>
            <Field
              label="Ringkasan"
              htmlFor="summary"
              className="sm:col-span-2"
              hint="Satu-dua kalimat; dipakai di kartu produk dan hasil pencarian."
            >
              <TextInput
                id="summary"
                name="summary"
                defaultValue={product.summary}
                disabled={!canEdit}
                maxLength={280}
              />
            </Field>
            <Field label="Deskripsi" htmlFor="description" required className="sm:col-span-2">
              <TextArea
                id="description"
                name="description"
                rows={8}
                defaultValue={product.description}
                required
                disabled={!canEdit}
              />
            </Field>
            <Field label="Merek" htmlFor="brand">
              <TextInput
                id="brand"
                name="brand"
                defaultValue={product.brand ?? ""}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Garansi" htmlFor="warranty">
              <TextInput
                id="warranty"
                name="warranty"
                defaultValue={product.warranty ?? ""}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Perawatan" htmlFor="careInstructions" className="sm:col-span-2">
              <TextInput
                id="careInstructions"
                name="careInstructions"
                defaultValue={product.careInstructions ?? ""}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Meta title (SEO)" htmlFor="metaTitle" hint="Kosong = pakai nama produk.">
              <TextInput
                id="metaTitle"
                name="metaTitle"
                defaultValue={product.seoTitle ?? ""}
                disabled={!canEdit}
                maxLength={70}
              />
            </Field>
            <Field label="Meta description (SEO)" htmlFor="metaDescription">
              <TextInput
                id="metaDescription"
                name="metaDescription"
                defaultValue={product.seoDescription ?? ""}
                disabled={!canEdit}
                maxLength={160}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" disabled={!canEdit}>
                Simpan perubahan
              </Button>
            </div>
          </form>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Status publikasi" />
            <form action={setProductStatusAction} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={product.id} />
              <Field label="Status" htmlFor="status" required>
                <SelectInput
                  id="status"
                  name="status"
                  defaultValue={product.status}
                  disabled={!canPublish}
                >
                  {PRODUCT_STATUSES.filter(
                    (status) => status !== "archived" || product.status === "archived",
                  ).map((status) => (
                    <option key={status} value={status}>
                      {status === "published"
                        ? "published - tampil di toko"
                        : status === "draft"
                          ? "draft - hanya staf"
                          : `${status} - tidak dijual`}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Alasan" htmlFor="reason" hint="Tercatat di audit log.">
                <TextInput
                  id="reason"
                  name="reason"
                  placeholder="Mis. melengkapi foto & spesifikasi"
                  disabled={!canPublish}
                />
              </Field>
              <Button type="submit" size="sm" disabled={!canPublish}>
                Simpan status
              </Button>
            </form>
            <p className="hint mt-2">
              Publish memicu validasi kelengkapan (minimal satu varian aktif + stok) di service.
              Slug dan harga diubah lewat tabel varian di bawah.
            </p>
          </Card>

          <Card>
            <CardHeader title="Kategori & atribut" />
            <dl className="flex flex-col gap-2 text-[14px]">
              <div className="flex justify-between gap-3">
                <dt className="text-secondary">Kategori</dt>
                <dd className="font-semibold">{product.categoryName}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-secondary">Slug</dt>
                <dd className="tnum">{product.slug}</dd>
              </div>
            </dl>
            {Object.keys(product.attributes).length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-1">
                {Object.entries(product.attributes).map(([key, value]) => (
                  <li key={key}>
                    <Badge tone="neutral">
                      {key}: {value}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="hint mt-2">
              Kategori tersedia:{" "}
              {categories
                .slice(0, 6)
                .map((category) => category.name)
                .join(", ")}
              {categories.length > 6 ? ` +${categories.length - 6} lainnya` : ""}. Pemindahan
              kategori dilakukan lewat SQL migrasi data agar slug tetap stabil.
            </p>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Varian, harga & stok"
          subtitle="Harga integer Rupiah; stok dijual = on_hand - reserved - safety_stock."
          action={
            <Link href="/admin/inventaris" className="link text-[13px] font-semibold">
              Kelola stok →
            </Link>
          }
        />
        <Table
          head={["Varian", "SKU", "Harga", "Bandingkan", "On hand", "Reserved", "Safety", "Status"]}
        >
          {product.variants.map((variant) => (
            <Tr key={variant.id}>
              <Td label="Varian">{variant.label || "Standar"}</Td>
              <Td label="SKU" className="tnum">
                {variant.sku}
              </Td>
              <Td label="Harga" className="tnum font-semibold">
                {formatIDR(variant.priceAmount)}
              </Td>
              <Td label="Bandingkan" className="tnum">
                {variant.compareAtAmount ? formatIDR(variant.compareAtAmount) : "-"}
              </Td>
              <Td label="On hand" className="tnum">
                {variant.onHand ?? "tidak dilacak"}
              </Td>
              <Td label="Reserved" className="tnum">
                {variant.reserved}
              </Td>
              <Td label="Safety" className="tnum">
                {variant.safetyStock}
              </Td>
              <Td label="Status">
                {variant.isActive ? (
                  <Badge tone="success">aktif</Badge>
                ) : (
                  <Badge tone="neutral">nonaktif</Badge>
                )}
              </Td>
            </Tr>
          ))}
        </Table>
        <p className="hint mt-2">
          {product.media.length} media tersimpan (
          {product.media.filter((item) => item.isPrimary).length} utama). Unggah file aktif setelah
          storage (S3/Supabase) dikonfigurasi; saat ini media memakai berkas contoh di /public/img.
        </p>
      </Card>
    </div>
  );
}
