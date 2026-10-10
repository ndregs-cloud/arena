import { formatIDR } from "@/lib/format";
import type { OrderSnapshot } from "@/domain/orders";

/** Daftar baris order; snapshot dari service, jadi tidak ada angka yang dihitung di klien. */
export function OrderLines({ lines }: { lines: OrderSnapshot["lines"] }) {
  return (
    <ul className="flex flex-col gap-3">
      {lines.map((line) => (
        <li key={line.orderItemId} className="flex items-start gap-3">
          {line.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={line.imageUrl}
              alt=""
              width={56}
              height={70}
              className="aspect-[4/5] w-14 rounded-tile border border-border bg-canvas object-cover"
            />
          ) : (
            <span
              className="aspect-[4/5] w-14 rounded-tile border border-border bg-canvas"
              aria-hidden="true"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink">{line.nameSnapshot}</span>
            <span className="block text-[13px] text-secondary">
              {line.variantLabelSnapshot} · SKU {line.sku}
            </span>
            <span className="tnum mt-1 block text-[13px] text-ink-soft">
              {line.quantity} × {formatIDR(line.unitPriceAmount)}
              {line.discountAllocatedAmount > 0 ? (
                <span className="text-success">
                  {" "}
                  · diskon {formatIDR(line.discountAllocatedAmount)}
                </span>
              ) : null}
            </span>
          </span>
          <span className="tnum shrink-0 text-[15px] font-semibold">
            {formatIDR(line.lineTotalAmount)}
          </span>
        </li>
      ))}
    </ul>
  );
}
