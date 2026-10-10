import type { ProductSummary } from "@/domain/catalog";
import { ProductCard } from "@/components/commerce/product-card";
import { EmptyState } from "@/components/ui/state";

export function ProductGrid({
  items,
  emptyTitle = "Produk tidak ditemukan",
  emptyDescription,
  priorityCount = 4,
}: {
  items: ProductSummary[];
  emptyTitle?: string;
  emptyDescription?: string;
  priorityCount?: number;
}) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} icon="⌕" />;
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
      {items.map((product, index) => (
        <li key={product.id}>
          <ProductCard product={product} priority={index < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
