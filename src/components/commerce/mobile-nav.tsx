"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * Drawer navigasi mobile. Dibuka oleh tombol di header (progressive: tanpa JS, daftar kategori
 * tetap tersedia lewat halaman /cari dan footer).
 */
export function MobileNav({
  categories,
  signedIn,
  isStaff,
}: {
  categories: Array<{ href: string; label: string }>;
  signedIn: boolean;
  isStaff: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const toggle = () => {
      const open = node.dataset.open === "true";
      node.dataset.open = open ? "false" : "true";
      document
        .getElementById("menu-mobile-open")
        ?.setAttribute("aria-expanded", open ? "false" : "true");
    };
    const button = document.getElementById("menu-mobile-open");
    button?.addEventListener("click", toggle);
    return () => button?.removeEventListener("click", toggle);
  }, []);

  return (
    <div
      ref={ref}
      id="menu-mobile"
      data-open="false"
      className="hidden data-[open=true]:block border-t border-border bg-surface md:hidden"
    >
      <div className="page flex flex-col gap-3 py-4">
        <form action="/cari" method="get" role="search" className="flex gap-2">
          <label htmlFor="mobile-search" className="sr-only">
            Cari produk
          </label>
          <input
            id="mobile-search"
            name="q"
            type="search"
            className="control"
            placeholder="Cari produk"
          />
          <button
            type="submit"
            className="min-h-[44px] rounded-control bg-brand px-3 font-semibold text-white"
          >
            Cari
          </button>
        </form>
        <nav aria-label="Kategori (mobile)">
          <ul className="divide-y divide-border rounded-card border border-border">
            {categories.map((category) => (
              <li key={category.href}>
                <Link
                  href={category.href}
                  className="block px-4 py-3 text-[15px] font-semibold text-ink hover:bg-canvas"
                >
                  {category.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <ul className="flex flex-col gap-2">
          <li>
            <Link
              href="/keranjang"
              className="block min-h-[44px] items-center rounded-control border border-border px-4 py-2 font-semibold"
            >
              Keranjang
            </Link>
          </li>
          <li>
            <Link
              href={signedIn ? "/akun/pesanan" : "/masuk"}
              className="block min-h-[44px] items-center rounded-control border border-border px-4 py-2 font-semibold"
            >
              {signedIn ? "Akun saya" : "Masuk / Daftar"}
            </Link>
          </li>
          {isStaff ? (
            <li>
              <Link
                href="/admin"
                className="block min-h-[44px] items-center rounded-control bg-brand px-4 py-2 font-semibold text-white"
              >
                Admin center
              </Link>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
