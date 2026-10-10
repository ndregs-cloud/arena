"use client";

import { Button, ButtonLink } from "@/components/ui/button";

/**
 * Boundary error untuk admin center. Penyebab paling umum bukan kerusakan teknis: staf
 * membuka tautan area yang memang tidak diizinkan perannya (navigasi menyembunyikannya,
 * tapi URL langsung tetap mungkin diketik). Keputusan tetap di service (requirePermission);
 * di sini hanya pesannya dibuat jelas.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="card card-pad">
      <h2 className="text-[18px] font-bold text-danger">Halaman admin tidak dapat dimuat</h2>
      <p className="mt-2 text-[14px] text-ink-soft">
        Dua kemungkinan: data gagal diambil, atau peran Anda tidak punya izin untuk area ini. Menu
        di sisi kiri hanya menampilkan area yang boleh Anda buka.
      </p>
      <p className="mt-2 text-[13px] text-secondary">
        Kode kejadian: <code className="tnum">{error.digest?.slice(0, 8) ?? "-"}</code> — cocokkan
        dengan log server atau kirimkan ke tim platform.
      </p>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={reset}>
          Coba lagi
        </Button>
        <ButtonLink href="/admin" variant="ghost" size="sm">
          Kembali ke ringkasan
        </ButtonLink>
      </div>
    </div>
  );
}
