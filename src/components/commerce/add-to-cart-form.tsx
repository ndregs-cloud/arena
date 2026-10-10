"use client";

import { useActionState } from "react";
import { addToCartAction } from "@/app/actions/cart";
import { EMPTY_FORM_STATE } from "@/lib/form-state";
import { Button } from "@/components/ui/button";
import { QuantityInput } from "@/components/ui/quantity-input";
import { Alert } from "@/components/ui/alert";

/**
 * Form tambah ke keranjang. Aksi server memvalidasi stok & batas per pesanan, jadi max di sini
 * hanya kenyamanan (nilai final tetap dihitung server, AT-03).
 */
export function AddToCartForm({
  variantId,
  min,
  max,
  disabled,
  disabledReason,
  variantLabel,
  goToCart = false,
}: {
  variantId: string;
  min: number;
  max: number;
  disabled?: boolean;
  disabledReason?: string | null;
  variantLabel: string;
  goToCart?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(addToCartAction, EMPTY_FORM_STATE);
  const effectiveMax = Math.max(min, max);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="variantId" value={variantId} />
      {goToCart ? <input type="hidden" name="redirect" value="cart" /> : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="label" id={`${variantId}-qty-label`}>
            Jumlah
          </span>
          <QuantityInput
            id={`${variantId}-qty`}
            name="quantity"
            min={min}
            max={effectiveMax}
            value={min}
            label={`Jumlah untuk ${variantLabel}`}
          />
        </div>
        <Button
          type="submit"
          disabled={disabled || isPending}
          className="min-w-[180px] flex-1"
          size="md"
        >
          {isPending ? "Menambahkan…" : "Tambah ke keranjang"}
        </Button>
      </div>
      {disabled && disabledReason ? (
        <Alert tone="warning" title={disabledReason}>
          Produk tetap tersedia di katalog; Anda bisa menyimpan halaman ini untuk nanti.
        </Alert>
      ) : null}
      {state.message ? (
        <Alert tone={state.tone === "danger" ? "danger" : "success"}>{state.message}</Alert>
      ) : null}
    </form>
  );
}
