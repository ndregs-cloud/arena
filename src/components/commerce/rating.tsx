import { formatRating } from "@/lib/format";
import type { ProductSummary } from "@/domain/catalog";
import { cn } from "@/lib/cn";

/** Bintang + angka teks. Aksesibel: nilai dibaca sebagai "4,6 dari 5 (128 ulasan)". */
export function Rating({
  average,
  count,
  size = "sm",
}: {
  average: number | null;
  count: number;
  size?: "sm" | "md";
}) {
  const value = average ?? 0;
  const stars = Math.round(value);
  return (
    <div className={cn("flex items-center gap-1.5", size === "md" && "text-[14px]")}>
      <span
        aria-hidden="true"
        className={cn("text-warning", size === "md" ? "text-[15px]" : "text-[13px]")}
      >
        {"★★★★★".slice(0, stars)}
        <span className="text-border">{"★★★★★".slice(stars)}</span>
      </span>
      <span className={cn("tnum text-secondary", size === "md" ? "text-[13px]" : "text-[12px]")}>
        {average === null ? "Belum ada ulasan" : `${formatRating(value)} dari 5 · ${count} ulasan`}
      </span>
      <span className="sr-only">
        {average === null
          ? "Belum ada ulasan"
          : `Nilai ${formatRating(value)} dari 5 dengan ${count} ulasan`}
      </span>
    </div>
  );
}

export function StockPill({
  product,
}: {
  product: Pick<ProductSummary, "stockState" | "availableQuantity">;
}) {
  if (product.stockState === "out_of_stock") {
    return (
      <span className="rounded-pill border border-danger/30 bg-danger-soft px-2 py-0.5 text-[12px] font-semibold text-danger">
        Stok habis
      </span>
    );
  }
  if (product.stockState === "low_stock") {
    return (
      <span className="rounded-pill border border-warning/30 bg-warning-soft px-2 py-0.5 text-[12px] font-semibold text-warning">
        Sisa {product.availableQuantity}
      </span>
    );
  }
  if (product.stockState === "not_tracked") return null;
  return (
    <span className="rounded-pill border border-success/30 bg-success-soft px-2 py-0.5 text-[12px] font-semibold text-success">
      Tersedia
    </span>
  );
}
