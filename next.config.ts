import type { NextConfig } from "next";

/**
 * Konfigurasi Next (Blueprint §10.2, §13.1).
 * - serverExternalPackages: pglite/postgres dimuat sebagai modul Node (WASI/native), tidak dibundel.
 * - Keamanan: cookie/CSRF ditangani di middleware + auth layer; header keamanan di-set di sini.
 * - Tidak ada secret yang dibaca saat build; semua konfigurasi runtime dibaca dari env saat request.
 */
const isProd = process.env.NODE_ENV === "production";

/**
 * Proteksi clickjacking aktif secara default. Untuk pratinjau lokal/CI yang perlu menampilkan app
 * di dalam iframe, set FRAME_ANCESTORS (mis. "self https://*.e2b.app") - jangan dilakukan di produksi.
 */
const frameAncestors = process.env.FRAME_ANCESTORS?.trim() || "'none'";
const allowFraming = frameAncestors !== "'none'";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  ...(allowFraming ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      `frame-ancestors ${frameAncestors}`,
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [],
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

if (isProd) {
  // Source maps membantu debugging namun jangan memuat variabel rahasia saat build.
  nextConfig.productionBrowserSourceMaps = false;
}

export default nextConfig;
