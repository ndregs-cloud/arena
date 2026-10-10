"use client";

import { useActionState } from "react";
import { applyCouponAction, removeCouponAction } from "@/app/actions/cart";
import { EMPTY_FORM_STATE } from "@/lib/form-state";

/** Form kode promo. Validasi (periode, limit, min. belanja) ada di service, bukan di sini. */
export function CouponForm({
  code,
  freeShippingApplied,
}: {
  code: string | null;
  freeShippingApplied: boolean;
}) {
  const [state, formAction, isPending] = useActionState(applyCouponAction, EMPTY_FORM_STATE);
  if (code) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-brand/30 bg-brand-soft px-3 py-2">
        <div>
          <p className="text-[14px] font-semibold text-brand">Kode aktif: {code}</p>
          <p className="hint">
            {freeShippingApplied
              ? "Ongkir gratis diterapkan."
              : "Potongan dihitung dari subtotal yang berlaku."}
          </p>
        </div>
        <form action={removeCouponAction}>
          <button
            type="submit"
            className="min-h-[36px] rounded-control border border-border bg-surface px-3 text-[13px] font-semibold hover:border-danger hover:text-danger"
          >
            Hapus promo
          </button>
        </form>
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label htmlFor="coupon" className="label">
        Kode promo (opsional)
      </label>
      <div className="flex gap-2">
        <input
          id="coupon"
          name="coupon"
          className="control"
          placeholder="Mis. HERO10"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={isPending}
          className="min-h-[44px] shrink-0 rounded-control border border-border bg-surface px-3 text-[14px] font-semibold hover:bg-canvas disabled:opacity-60"
        >
          {isPending ? "Memeriksa…" : "Pakai"}
        </button>
      </div>
      {state.message ? (
        <p
          role="status"
          className={
            state.tone === "danger"
              ? "hint font-semibold text-danger"
              : "hint font-semibold text-success"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
