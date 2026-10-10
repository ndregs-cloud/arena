import type { ReactNode } from "react";
import { getRequestContext } from "@/server/context";
import { getCartView } from "@/server/services/cart.service";
import { evaluateCheckoutReadiness } from "@/server/services/checkout.service";
import { CheckoutStepper } from "@/components/commerce/checkout-stepper";
import { CartTotals } from "@/components/commerce/cart-totals";
import { Card } from "@/components/ui/card";
import { SIMULATION_NOTE } from "@/lib/brand";

const STEPS = [
  { id: "alamat", label: "Alamat", href: "/checkout/alamat" },
  { id: "pengiriman", label: "Pengiriman", href: "/checkout/pengiriman" },
  { id: "pembayaran", label: "Pembayaran", href: "/checkout/pembayaran" },
  { id: "review", label: "Tinjau", href: "/checkout/review" },
];

/**
 * Kerangka checkout: stepper 4 langkah (desain §7) + ringkasan yang selalu dihitung ulang dari
 * service. Lebar form 60-64% agar field tidak melebar berlebihan.
 */
export default async function CheckoutLayout({ children }: { children: ReactNode }) {
  const ctx = await getRequestContext();
  const [view, readiness] = await Promise.all([getCartView(ctx), evaluateCheckoutReadiness(ctx)]);
  const blocked = new Set(readiness.blockers.map((blocker) => blocker.step));
  const done = STEPS.filter(
    (step) => !blocked.has(step.id as (typeof readiness.blockers)[number]["step"]),
  ).map((step) => step.id);

  return (
    <div className="page section">
      <div className="mb-6">
        <h1 className="mb-3">Checkout</h1>
        <CheckoutStepper steps={STEPS} done={done} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 lg:max-w-[64%]">{children}</div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <p className="mb-3 text-[16px] font-bold">Ringkasan pesanan</p>
            <CartTotals view={view} />
            <p className="hint mt-3">{SIMULATION_NOTE}</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
