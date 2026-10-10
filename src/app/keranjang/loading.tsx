import { Skeleton } from "@/components/ui/state";

/** Skeleton keranjang (tidak ada 404/redirect di rute ini - lihat catatan di `cari/loading.tsx`). */
export default function CartLoading() {
  return (
    <div className="page section" aria-busy="true" aria-live="polite">
      <p className="sr-only">Memuat keranjang…</p>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}
