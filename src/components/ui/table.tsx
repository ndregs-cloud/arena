import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Tabel data admin. Di bawah 600px tabel berubah jadi kartu (baris pertama = judul) lewat
 * [data-label] agar tetap terbaca tanpa horizontal scroll.
 */
export function Table({
  head,
  children,
  caption,
}: {
  head: ReactNode[];
  children: ReactNode;
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
        {caption ? (
          <caption className="px-4 pt-3 text-left text-[13px] text-secondary">{caption}</caption>
        ) : null}
        <thead className="bg-canvas text-[12px] uppercase tracking-wide text-secondary">
          <tr>
            {head.map((cell, i) => (
              <th key={i} scope="col" className="px-4 py-2 font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("align-top hover:bg-canvas/60", className)}>{children}</tr>;
}

export function Td({
  children,
  label,
  className,
}: {
  children?: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <td className={cn("px-4 py-3 text-ink-soft", className)} data-label={label}>
      {children}
    </td>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th scope="row" className={cn("px-4 py-3 font-semibold text-ink", className)}>
      {children}
    </th>
  );
}
