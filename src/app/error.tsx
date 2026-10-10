"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/state";
import { Button } from "@/components/ui/button";

/**
 * Batas error untuk rute storefront. Pesan teknis tidak ditampilkan ke pelanggan; requestId
 * dipakai untuk mencocokkan log (Blueprint §12.2).
 */
export default function StorefrontError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("storefront.error", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="page section">
      <ErrorState
        title="Halaman gagal dimuat"
        description={
          <>
            Data produk, keranjang, atau status pesanan tidak bisa diambil saat ini. Coba muat
            ulang. Bila terus terjadi, sebutkan kode{" "}
            <code className="rounded-tile bg-canvas px-1">{error.digest?.slice(0, 8) ?? "-"}</code>{" "}
            ke tim dukungan.
          </>
        }
        action={
          <Button type="button" onClick={reset}>
            Coba lagi
          </Button>
        }
      />
    </div>
  );
}
