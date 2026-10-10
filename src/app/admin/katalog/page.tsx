import type { Metadata } from "next";
import Link from "next/link";
import { hasPermission, requireStaffPage } from "@/server/context";
import { adminListProducts } from "@/server/services/catalog.service";
import { PRODUCT_STATUSES } from "@/domain/catalog";
import { formatDateTime, formatIDR } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, Td, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/state";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = {
  title: "Admin - katalog",
  robots: { index: false, follow: false },
};

const TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  published: "success",
  draft: "neutral",
  archived: "warning",
  out_of_stock: "danger",
};

export default async function AdminCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    page?: string;
    pesan?: string;
    err?: string;
  }>;
}) {
  const query = await searchParams;
  const ctx = await requireStaffPage("/admin/katalog");
  const page = Number(query.page ?? 1) || 1;
  const result = await adminListProducts({
    q: query.q,
    status: (query.status as (typeof PRODUCT_STATUSES)[number] | "all") ?? "all",
    page,
    perPage: 20,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] leading-[32px]">Katalog</h1>
          <p className="mt-1 text-[13px] text-secondary">
            {result.total} produk · perubahan harga besar tercatat ke riwayat harga.
          </p>
        </div>
        {hasPermission(ctx, "catalog.create") ? (
          <Link
            href="/admin/katalog/baru"
            className="min-h-[44px] inline-flex items-center rounded-control bg-brand px-4 text-[14px] font-semibold text-white hover:bg-brand-hover"
          >
            Produk baru
          </Link>
        ) : null}
      </div>

      {query.pesan ? <Alert tone="success">{query.pesan}</Alert> : null}
      {query.err ? <Alert tone="danger">{query.err}</Alert> : null}

      <Card>
        <CardHeader
          title="Filter"
          subtitle="Status 'draft' hanya muncul untuk akun dengan izin melihat draf."
        />
        <form method="get" action="/admin/katalog" className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[240px] flex-1 flex-col gap-1">
            <span className="label">Nama / SKU / slug</span>
            <input name="q" defaultValue={query.q ?? ""} className="control" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Status</span>
            <select
              name="status"
              defaultValue={query.status ?? "all"}
              className="control min-w-[160px]"
            >
              <option value="all">Semua</option>
              {PRODUCT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="min-h-[44px] rounded-control bg-brand px-4 text-[15px] font-semibold text-white hover:bg-brand-hover"
          >
            Terapkan
          </button>
        </form>
      </Card>

      {result.rows.length === 0 ? (
        <EmptyState
          title="Tidak ada produk"
          description="Ubah filter atau jalankan seed katalog."
          icon="◇"
        />
      ) : (
        <Table head={["Produk", "Kategori", "Harga", "Stok", "Diperbarui", "Aksi"]}>
          {result.rows.map((row) => (
            <Tr key={row.id}>
              <Td label="Produk">
                <Link className="link font-semibold" href={`/admin/katalog/${row.id}`}>
                  {row.name}
                </Link>
                <span className="block text-[12px] text-secondary">
                  SKU {row.sku} · {row.variantCount} varian
                  {row.brand ? ` · ${row.brand}` : ""}
                </span>
              </Td>
              <Td label="Kategori">
                {row.categoryName}
                <span className="block">
                  <Badge tone={TONE[row.status] ?? "neutral"}>{row.status}</Badge>
                </span>
              </Td>
              <Td label="Harga" className="tnum">
                {formatIDR(row.minPriceAmount)}
              </Td>
              <Td label="Stok" className="tnum">
                {row.totalStock}
                {row.lowStockVariants > 0 ? (
                  <span className="ml-1 text-[12px] font-semibold text-warning">
                    {row.lowStockVariants} varian menipis
                  </span>
                ) : null}
              </Td>
              <Td label="Diperbarui" className="text-[13px]">
                {formatDateTime(row.updatedAt)}
              </Td>
              <Td label="Aksi">
                <Link
                  href={`/admin/katalog/${row.id}`}
                  className="min-h-[36px] inline-flex items-center rounded-control border border-border px-3 text-[13px] font-semibold hover:bg-canvas"
                >
                  Kelola
                </Link>
              </Td>
            </Tr>
          ))}
        </Table>
      )}

      <Pagination
        page={result.page}
        perPage={result.perPage}
        total={result.total}
        base="/admin/katalog"
        searchParams={{ q: query.q, status: query.status }}
      />
    </div>
  );
}
