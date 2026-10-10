import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({
  children,
  className,
  as: As = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li";
}) {
  return <As className={cn("card card-pad", className)}>{children}</As>;
}

export function CardHeader({
  title,
  subtitle,
  action,
  id,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
      <div className="min-w-0">
        <h3 id={id} className="truncate text-[18px] leading-[26px]">
          {title}
        </h3>
        {subtitle ? (
          <p className="mt-1 text-[13px] leading-[19px] text-secondary">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
