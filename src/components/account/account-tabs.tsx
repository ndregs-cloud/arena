"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/akun/pesanan", label: "Pesanan" },
  { href: "/akun/retur", label: "Retur & refund" },
  { href: "/akun/alamat", label: "Alamat" },
  { href: "/akun/wishlist", label: "Wishlist" },
  { href: "/akun/profil", label: "Profil & keamanan" },
  { href: "/akun/privasi", label: "Privasi" },
];

export function AccountTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Bagian akun">
      <ul className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((tab) => {
          const active =
            pathname === tab.href ||
            (tab.href !== "/akun/pesanan" && pathname.startsWith(tab.href));
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 border-brand px-3 text-[14px] font-semibold text-brand"
                    : "inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 border-transparent px-3 text-[14px] font-semibold text-secondary hover:text-ink"
                }
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
