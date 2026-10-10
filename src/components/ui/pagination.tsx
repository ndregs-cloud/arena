import Link from "next/link";
import { cn } from "@/lib/cn";

function pageUrl(base: string, page: number, search: URLSearchParams): string {
  const params = new URLSearchParams(search);
  if (page <= 1) params.delete("page");
  else params.set("page", String(page));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Navigasi halaman berbasis tautan (SEO + bisa dipakai tanpa JS). */
export function Pagination({
  page,
  perPage,
  total,
  base,
  searchParams,
}: {
  page: number;
  perPage: number;
  total: number;
  base: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, perPage)));
  if (pages <= 1) return null;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string" && key !== "page") search.set(key, value);
    else if (Array.isArray(value) && value.length > 0) search.set(key, value.join(","));
  }
  const window: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p += 1) window.push(p);

  return (
    <nav aria-label="Navigasi halaman" className="mt-6 flex flex-wrap items-center gap-1">
      {page > 1 ? (
        <Link
          href={pageUrl(base, page - 1, search)}
          className="min-h-[44px] inline-flex items-center rounded-control border border-border px-3 text-[14px] font-semibold hover:bg-canvas"
        >
          ← Sebelumnya
        </Link>
      ) : null}
      {window[0]! > 1 ? <span className="px-2 text-secondary">…</span> : null}
      {window.map((p) => (
        <Link
          key={p}
          href={pageUrl(base, p, search)}
          aria-current={p === page ? "page" : undefined}
          className={cn(
            "tnum size-11 inline-flex items-center justify-center rounded-control border text-[14px] font-semibold",
            p === page ? "border-brand bg-brand text-white" : "border-border hover:bg-canvas",
          )}
        >
          {p}
        </Link>
      ))}
      {window[window.length - 1]! < pages ? <span className="px-2 text-secondary">…</span> : null}
      {page < pages ? (
        <Link
          href={pageUrl(base, page + 1, search)}
          className="min-h-[44px] inline-flex items-center rounded-control border border-border px-3 text-[14px] font-semibold hover:bg-canvas"
        >
          Berikutnya →
        </Link>
      ) : null}
      <span className="ml-auto hint">
        Halaman {page} dari {pages} · {total} hasil
      </span>
    </nav>
  );
}
