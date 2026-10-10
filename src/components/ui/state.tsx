import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("animate-pulse rounded-card bg-border/60", className)} />
  );
}

export function SkeletonList({ count = 4, height = "h-24" }: { count?: number; height?: string }) {
  return (
    <div className="grid gap-4">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={height} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon = "◇",
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border bg-surface px-6 py-10 text-center">
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-pill bg-canvas text-[18px] text-secondary"
      >
        {icon}
      </span>
      <p className="font-semibold text-ink">{title}</p>
      {description ? (
        <p className="max-w-prose text-[14px] leading-[20px] text-secondary">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Terjadi kesalahan",
  description,
  action,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-card border border-danger/30 bg-danger-soft px-5 py-4"
    >
      <p className="font-semibold text-danger">{title}</p>
      {description ? (
        <p className="text-[14px] leading-[20px] text-ink-soft">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

/** Indikator proses untuk aksi async (labels = teks, bukan hanya spinner). */
export function PendingLabel({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      {pending ? (
        <span
          aria-hidden="true"
          className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      ) : null}
      {children}
    </span>
  );
}
