import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { BRAND } from "@/lib/brand";

/** Kerangka halaman akun/autentikasi: kartu terpusat, tautan kembali, judul sebagai heading utama. */
export function CenteredCard({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="page section grid place-items-start py-8">
      <div className={wide ? "w-full max-w-[860px]" : "w-full max-w-[460px]"}>
        <Link
          href="/"
          className="mb-3 inline-block text-[13px] text-secondary hover:text-brand hover:underline"
        >
          ← Kembali ke {BRAND.name}
        </Link>
        <h1 className="text-[24px] leading-[32px]">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-[14px] leading-[20px] text-secondary">{subtitle}</p>
        ) : null}
        <Card className="mt-4">{children}</Card>
      </div>
    </div>
  );
}
