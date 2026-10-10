import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { BRAND } from "@/lib/brand";
import { SiteHeader } from "@/components/commerce/site-header";
import { SiteFooter } from "@/components/commerce/site-footer";

/**
 * Shell global: bahasa id-ID, token desain, dan navigasi. Header memanggil service keranjang,
 * jadi seluruh rute storefront dirender dinamis (data harga/stok tidak boleh di-cache statis).
 */
/**
 * Semua halaman membaca cookie sesi/keranjang + data stok/harga dari DB, jadi tidak ada yang boleh
 * di-prerender saat build (dan build pun tidak perlu menyalakan basis data).
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: `${BRAND.name} - ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.tagline,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "id_ID",
    siteName: BRAND.name,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#315CFF",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" dir="ltr">
      <body className="flex min-h-dvh flex-col antialiased">
        <a
          href="#konten"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:shadow-pop"
        >
          Lompat ke konten utama
        </a>
        <SiteHeader />
        <main id="konten" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
