"use client";

import { usePathname } from "next/navigation";
import { Stepper, type StepItem } from "@/components/ui/stepper";

/** Step aktif dibaca dari pathname (layout server tidak menerima path). */
export function CheckoutStepper({
  steps,
  done,
}: {
  steps: Array<{ id: string; label: string; href: string }>;
  done: string[];
}) {
  const pathname = usePathname();
  const items: StepItem[] = steps.map((step) => ({
    ...step,
    state: pathname === step.href ? "current" : done.includes(step.id) ? "done" : "todo",
  }));
  return <Stepper steps={items} />;
}
