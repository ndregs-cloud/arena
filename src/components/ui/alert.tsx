import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type AlertTone = "info" | "success" | "warning" | "danger";

const STYLES: Record<AlertTone, { box: string; title: string; icon: string }> = {
  info: { box: "border-info/30 bg-info-soft text-ink", title: "text-info", icon: "ℹ" },
  success: { box: "border-success/30 bg-success-soft text-ink", title: "text-success", icon: "✓" },
  warning: { box: "border-warning/30 bg-warning-soft text-ink", title: "text-warning", icon: "!" },
  danger: { box: "border-danger/30 bg-danger-soft text-ink", title: "text-danger", icon: "✕" },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  role,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: "status" | "alert";
}) {
  const style = STYLES[tone];
  return (
    <div
      role={role ?? (tone === "danger" || tone === "warning" ? "alert" : "status")}
      className={cn(
        "flex gap-3 rounded-card border px-4 py-3 text-[14px] leading-[20px]",
        style.box,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-pill border border-current text-[12px] font-bold",
          style.title,
        )}
      >
        {style.icon}
      </span>
      <div className="min-w-0 flex-1">
        {title ? <p className={cn("font-semibold", style.title)}>{title}</p> : null}
        {children ? <div className="mt-0.5 text-ink-soft">{children}</div> : null}
      </div>
    </div>
  );
}
