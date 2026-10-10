import type { MetadataRoute } from "next";
import { env } from "@/platform/env";

export default function robots(): MetadataRoute.Robots {
  const base = env.appUrl.replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/akun",
          "/checkout",
          "/keranjang",
          "/konfirmasi",
          "/simulasi-pembayaran",
          "/kembali-pembayaran",
          "/api/",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
