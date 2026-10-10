import Link from "next/link";
import { cn } from "@/lib/cn";

export interface StepItem {
  id: string;
  label: string;
  href: string;
  state: "done" | "current" | "todo";
  note?: string;
}

/** Progres checkout 4 langkah (desain §7). Status ditulis dengan angka + label, bukan warna saja. */
export function Stepper({ steps }: { steps: StepItem[] }) {
  return (
    <ol className="flex flex-wrap gap-x-2 gap-y-1">
      {steps.map((step, index) => {
        const canNavigate = step.state !== "todo";
        const body = (
          <>
            <span
              aria-hidden="true"
              className={cn(
                "flex size-6 items-center justify-center rounded-pill border text-[12px] font-bold",
                step.state === "done" && "border-success bg-success text-white",
                step.state === "current" && "border-brand bg-brand text-white",
                step.state === "todo" && "border-border bg-surface text-secondary",
              )}
            >
              {step.state === "done" ? "✓" : index + 1}
            </span>
            <span className="text-[14px] font-semibold">{step.label}</span>
            <span className="sr-only">
              {step.state === "done"
                ? " (selesai)"
                : step.state === "current"
                  ? " (langkah saat ini)"
                  : " (belum bisa diisi)"}
            </span>
          </>
        );
        return (
          <li key={step.id} className="flex items-center gap-2">
            {canNavigate ? (
              <Link
                href={step.href}
                aria-current={step.state === "current" ? "step" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-control px-2 py-1",
                  step.state === "current" ? "text-brand" : "text-ink-soft hover:bg-canvas",
                )}
              >
                {body}
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="inline-flex items-center gap-2 px-2 py-1 text-secondary"
              >
                {body}
              </span>
            )}
            {index < steps.length - 1 ? (
              <span aria-hidden="true" className="text-border">
                /
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
