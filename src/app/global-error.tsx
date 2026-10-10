"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          background: "#F5F7FB",
          color: "#172033",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div
            style={{
              maxWidth: 560,
              background: "#fff",
              border: "1px solid #E3E8F0",
              borderRadius: 14,
              padding: 24,
            }}
          >
            <h1 style={{ fontSize: 24, margin: 0 }}>Aplikasi mengalami masalah</h1>
            <p style={{ marginTop: 8, lineHeight: 1.5 }}>
              Kami mencatat kode <code>{error.digest?.slice(0, 8) ?? "-"}</code>. Silakan muat ulang
              halaman atau kembali ke beranda.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <Button type="button" onClick={reset}>
                Muat ulang
              </Button>
              {/* global-error merender <html> sendiri: tidak ada AppRouter context, jadi Link tidak
                  boleh dipakai di sini. Navigasi penuh memang yang diinginkan. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" style={{ textDecoration: "none" }}>
                <Button type="button" variant="secondary">
                  Ke beranda
                </Button>
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
