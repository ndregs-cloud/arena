import Link from "next/link";
import { BRAND, SIMULATION_NOTE } from "@/lib/brand";
import { listTopCategories } from "@/server/services/catalog.service";

const HELPFUL = [
  { href: "/bantuan", label: "Pusat bantuan" },
  { href: "/kebijakan/pengiriman", label: "Kebijakan pengiriman" },
  { href: "/kebijakan/retur", label: "Kebijakan retur & refund" },
  { href: "/privasi", label: "Kebijakan privasi" },
  { href: "/syarat", label: "Syarat & ketentuan" },
];

export function SiteFooter() {
  const categories = listTopCategories().catch(() => []);
  return (
    <footer className="mt-12 border-t border-border bg-surface">
      <div className="page section grid gap-8 md:grid-cols-4">
        <div>
          <p className="text-[18px] font-bold text-ink">{BRAND.name}</p>
          <p className="mt-1 text-[13px] leading-[19px] text-secondary">{BRAND.tagline}</p>
          <p className="mt-3 text-[12px] leading-[16px] text-secondary">
            {BRAND.legalName} · {BRAND.supportEmail} · {BRAND.supportHours}
          </p>
        </div>
        <FooterColumn
          title="Belanja"
          loader={categories.then((rows) =>
            rows.map((c) => ({ href: `/kategori/${c.slug}`, label: c.name })),
          )}
          fallback={[{ href: "/cari", label: "Semua produk" }]}
        />
        <FooterColumn title="Bantuan & kebijakan" fallback={HELPFUL} />
        <div>
          <p className="text-[13px] font-bold uppercase tracking-wide text-secondary">
            Catatan lingkungan
          </p>
          <p className="mt-2 rounded-card border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] leading-[16px] text-ink-soft">
            {SIMULATION_NOTE}
          </p>
          <ul className="mt-3 flex flex-wrap gap-2 text-[12px] text-secondary">
            <li>
              <Link className="link" href="/akun/pesanan">
                Lacak pesanan
              </Link>
            </li>
            <li>·</li>
            <li>
              <Link className="link" href="/admin">
                Admin center
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}

async function FooterColumn({
  title,
  fallback,
  loader,
}: {
  title: string;
  fallback: Array<{ href: string; label: string }>;
  loader?: Promise<Array<{ href: string; label: string }>>;
}) {
  const items = loader ? await loader : fallback;
  return (
    <nav aria-label={title}>
      <p className="text-[13px] font-bold uppercase tracking-wide text-secondary">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {(items.length > 0 ? items : fallback).map((item) => (
          <li key={item.href + item.label}>
            <Link
              href={item.href}
              className="text-[14px] text-ink-soft hover:text-brand hover:underline"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
