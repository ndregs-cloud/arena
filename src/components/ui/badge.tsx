import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-canvas text-ink-soft border-border",
  brand: "bg-brand-soft text-brand border-brand/30",
  success: "bg-success-soft text-success border-success/30",
  warning: "bg-warning-soft text-warning border-warning/30",
  danger: "bg-danger-soft text-danger border-danger/30",
  info: "bg-info-soft text-info border-info/30",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[12px] font-semibold leading-[16px]",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Status order/pembayaran/pengiriman/retur -> label + tone (warna tidak pernah sendirian). */
const ORDER_TONES: Record<string, Tone> = {
  draft: "neutral",
  pending_payment: "warning",
  paid: "info",
  processing: "info",
  on_hold: "warning",
  shipped: "brand",
  delivered: "success",
  completed: "success",
  cancelled: "neutral",
  refunded: "neutral",
  return_requested: "warning",
  return_approved: "warning",
  returned: "info",
};

const PAYMENT_TONES: Record<string, Tone> = {
  awaiting_payment: "warning",
  pending: "warning",
  succeeded: "success",
  partially_refunded: "info",
  refunded: "neutral",
  failed: "danger",
  expired: "danger",
  needs_review: "danger",
};

const SHIPMENT_TONES: Record<string, Tone> = {
  none: "neutral",
  created: "neutral",
  label_ready: "info",
  picked_up: "brand",
  in_transit: "brand",
  out_for_delivery: "info",
  delivered: "success",
  exception: "danger",
  returned_to_sender: "warning",
  cancelled: "neutral",
};

const RETURN_TONES: Record<string, Tone> = {
  requested: "warning",
  awaiting_return: "info",
  item_received: "info",
  inspected: "brand",
  approved: "success",
  resolved: "success",
  rejected: "danger",
  cancelled: "neutral",
  expired: "neutral",
};

export type StatusKind = "order" | "payment" | "shipment" | "return";

const MAPS: Record<StatusKind, Record<string, Tone>> = {
  order: ORDER_TONES,
  payment: PAYMENT_TONES,
  shipment: SHIPMENT_TONES,
  return: RETURN_TONES,
};

export function StatusChip({
  status,
  label,
  kind = "order",
}: {
  status: string;
  label: string;
  kind?: StatusKind;
}) {
  return (
    <Badge tone={MAPS[kind][status] ?? "neutral"}>
      <span aria-hidden="true" className="size-2 rounded-full bg-current opacity-70" />
      {label}
    </Badge>
  );
}
