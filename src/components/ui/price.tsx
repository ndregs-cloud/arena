import { formatIDR, formatPercent } from "@/lib/format";
import { discountPercentage } from "@/domain/catalog";
import { cn } from "@/lib/cn";

/**
 * Blok harga IDR. Format mockup USD tidak pernah dipakai: semua angka dari DB (integer rupiah)
 * lalu diformat id-ID. Coret harga + persen hemat ditampilkan bersamaan (desain §6).
 */
export function PriceBlock({
  amount,
  compareAt,
  size = "md",
  className,
}: {
  amount: number;
  compareAt?: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const percent = compareAt && compareAt > amount ? discountPercentage(amount, compareAt) : null;
  const sizeClass =
    size === "lg"
      ? "text-[28px] leading-[36px]"
      : size === "sm"
        ? "text-[15px] leading-[20px]"
        : "text-[20px] leading-[28px]";
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-1", className)}>
      <span className={cn("tnum font-bold text-ink", sizeClass)}>{formatIDR(amount)}</span>
      {compareAt && compareAt > amount ? (
        <>
          <span className="tnum text-[13px] text-secondary line-through">
            {formatIDR(compareAt)}
          </span>
          {percent ? (
            <span className="rounded-pill bg-danger-soft px-1.5 py-0.5 text-[12px] font-bold text-danger">
              Hemat {formatPercent(percent)}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
