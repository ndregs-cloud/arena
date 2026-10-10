import { EmptyState } from "@/components/ui/state";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="page section">
      <EmptyState
        title="Halaman tidak ditemukan"
        description="Tautan mungkin sudah berubah atau produk sudah diturunkan. Coba cari produknya, atau lihat kategori terbaru."
        action={
          <div className="mt-2 flex gap-2">
            <ButtonLink href="/cari">Cari produk</ButtonLink>
            <ButtonLink href="/" variant="secondary">
              Ke beranda
            </ButtonLink>
          </div>
        }
        icon="404"
      />
    </div>
  );
}
