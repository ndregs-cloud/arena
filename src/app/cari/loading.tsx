import { SkeletonList } from "@/components/ui/state";

/**
 * Skeleton untuk halaman hasil cari.
 *
 * CATATAN PENTING: `loading.tsx` TIDAK boleh dipasang di `src/app/loading.tsx` (akar) maupun di
 * segmen yang bisa menghasilkan 404/redirect (`/produk/[slug]`, `/kategori/[slug]`, `/akun`).
 * Boundary di level itu membuat server mengirim shell lebih dulu dengan status 200, sehingga
 * `notFound()` dan `redirect()` berubah menjadi "soft 404 / meta-refresh" - status HTTP yang salah
 * bagi mesin pencari (Blueprint §12.3, [R8]). Di halaman ini keduanya tidak mungkin terjadi.
 */
export default function SearchLoading() {
  return (
    <div className="page section" aria-busy="true" aria-live="polite">
      <p className="sr-only">Memuat hasil pencarian…</p>
      <SkeletonList count={3} height="h-40" />
    </div>
  );
}
