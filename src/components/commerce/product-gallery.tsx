"use client";

import { useState } from "react";
import type { ProductMedia } from "@/domain/catalog";
import { cn } from "@/lib/cn";

/**
 * Galeri media PDP (55-58% lebar di desktop, desain §9.2). Thumbnail mengubah gambar utama;
 * tanpa JS gambar pertama tetap tampil dan semua gambar ada di DOM (bisa di-zoom/print).
 */
export function ProductGallery({ media, alt }: { media: ProductMedia[]; alt: string }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const ordered = media.length > 0 ? media : [];
  const active = ordered.find((item) => item.id === activeId) ?? ordered[0];

  if (!active) {
    return (
      <div className="flex aspect-[4/5] w-full items-center justify-center rounded-card border border-border bg-canvas text-[14px] text-secondary">
        Gambar produk belum tersedia
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-card border border-border bg-canvas">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={active.url}
          alt={active.altText || alt}
          width={900}
          height={1125}
          className="size-full object-cover"
        />
        <p className="absolute bottom-2 right-2 rounded-pill bg-ink/70 px-2 py-0.5 text-[11px] font-semibold text-white">
          Gambar {ordered.findIndex((item) => item.id === active.id) + 1} dari {ordered.length}
        </p>
      </div>
      {ordered.length > 1 ? (
        <ul className="grid grid-cols-5 gap-2" aria-label="Pilih gambar">
          {ordered.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setActiveId(item.id)}
                aria-pressed={item.id === active.id}
                aria-label={`Tampilkan gambar ${index + 1}`}
                className={cn(
                  "block aspect-square w-full overflow-hidden rounded-tile border-2 bg-canvas",
                  item.id === active.id ? "border-brand" : "border-transparent hover:border-border",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.url}
                  alt=""
                  width={160}
                  height={160}
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
