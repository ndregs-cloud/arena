import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasPermission, requireStaffPage } from "@/server/context";
import { listCategories } from "@/server/services/catalog.service";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { createProductAction } from "@/app/actions/admin";

export const metadata: Metadata = {
  title: "Admin - produk baru",
  robots: { index: false, follow: false },
};

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const query = await searchParams;
  const ctx = await requireStaffPage("/admin/katalog/baru");
  if (!hasPermission(ctx, "catalog.create"))
    redirect("/admin/katalog?err=Anda+tidak+punya+izin+catalog.create.");
  const categories = await listCategories();

  return (
    <div className="flex max-w-[860px] flex-col gap-4">
      <div>
        <h1 className="text-[24px] leading-[32px]">Produk baru</h1>
        <p className="mt-1 text-[13px] text-secondary">
          Produk dibuat sebagai draf: tidak tampil di toko sebelum dipublikasikan.
        </p>
      </div>
      {query.err ? <Alert tone="danger">{query.err}</Alert> : null}

      <Card>
        <CardHeader title="Data utama" />
        <form action={createProductAction} className="grid gap-3 sm:grid-cols-2">
          <Field label="Nama produk" htmlFor="name" required className="sm:col-span-2">
            <TextInput id="name" name="name" required />
          </Field>
          <Field label="SKU utama" htmlFor="sku" required hint="3-64 karakter.">
            <TextInput
              id="sku"
              name="sku"
              required
              minLength={3}
              maxLength={64}
              placeholder="NS-XX-000"
            />
          </Field>
          <Field label="Kategori" htmlFor="categoryId" required>
            <SelectInput
              id="categoryId"
              name="categoryId"
              defaultValue={categories[0]?.id}
              required
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Merek" htmlFor="brand">
            <TextInput id="brand" name="brand" />
          </Field>
          <Field label="Status" htmlFor="status" required>
            <SelectInput id="status" name="status" defaultValue="draft">
              <option value="draft">draft</option>
              <option value="published">published (butuh kelengkapan)</option>
            </SelectInput>
          </Field>
          <Field label="Ringkasan" htmlFor="summary" className="sm:col-span-2">
            <TextInput id="summary" name="summary" maxLength={280} />
          </Field>
          <Field label="Deskripsi" htmlFor="description" required className="sm:col-span-2">
            <TextArea id="description" name="description" rows={6} required />
          </Field>
          <div className="sm:col-span-2">
            <p className="label mb-2">Varian pertama (selalu dibuat bersama produk)</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="SKU varian" htmlFor="variantSku">
                <TextInput id="variantSku" name="variantSku" />
              </Field>
              <Field label="Label varian" htmlFor="variantLabel">
                <TextInput id="variantLabel" name="variantLabel" placeholder="Standar" />
              </Field>
              <Field label="Harga (Rp)" htmlFor="priceAmount" required>
                <TextInput
                  id="priceAmount"
                  name="priceAmount"
                  type="number"
                  min={0}
                  required
                  defaultValue={0}
                />
              </Field>
              <Field label="Harga coret (Rp)" htmlFor="compareAtAmount">
                <TextInput id="compareAtAmount" name="compareAtAmount" type="number" min={0} />
              </Field>
              <Field label="Stok awal" htmlFor="stockQuantity">
                <TextInput
                  id="stockQuantity"
                  name="stockQuantity"
                  type="number"
                  min={0}
                  defaultValue={0}
                />
              </Field>
              <Field label="Ambang stok menipis" htmlFor="lowStockThreshold">
                <TextInput
                  id="lowStockThreshold"
                  name="lowStockThreshold"
                  type="number"
                  min={0}
                  defaultValue={3}
                />
              </Field>
            </div>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit">Buat produk</Button>
            <Link
              href="/admin/katalog"
              className="min-h-[44px] inline-flex items-center rounded-control border border-border bg-surface px-4 text-[15px] font-semibold"
            >
              Batal
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
