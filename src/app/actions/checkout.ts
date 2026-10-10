"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@/domain/errors";
import { getRequestContext } from "@/server/context";
import { getCartView, saveCheckoutDraft } from "@/server/services/cart.service";
import { createOrder } from "@/server/services/checkout.service";
import { clearShippingSelection, selectShipping } from "@/server/services/shipping.service";
import { saveAddress } from "@/server/services/account.service";
import type { DraftAddress } from "@/server/services/cart.service";

/**
 * Aksi checkout: setiap langkah menulis draft ke server (carts.draft) lalu menghitung ulang
 * harga/ongkir di service. Nomor order + pembayaran dibuat dengan idempotency key berbasis cart,
 * sehingga klik ganda / retry jaringan tidak membuat pesanan ganda.
 */

const STEPS = {
  alamat: "/checkout/alamat",
  pengiriman: "/checkout/pengiriman",
  pembayaran: "/checkout/pembayaran",
  review: "/checkout/review",
} as const;

function errorTo(e: unknown): string {
  return e instanceof AppError ? e.message : "Permintaan tidak dapat diproses. Coba lagi.";
}

function revalidateCheckout() {
  for (const path of Object.values(STEPS)) revalidatePath(path);
  revalidatePath("/keranjang");
}

function addressFromForm(formData: FormData): DraftAddress {
  return {
    fullName: String(formData.get("fullName") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    province: String(formData.get("province") ?? "").trim(),
    city: String(formData.get("city") ?? "").trim(),
    district: String(formData.get("district") ?? "").trim(),
    postalCode: String(formData.get("postalCode") ?? "").trim(),
    street: String(formData.get("street") ?? "").trim(),
    landmark: String(formData.get("landmark") ?? "").trim() || null,
  };
}

export async function saveAddressStepAction(formData: FormData): Promise<void> {
  const ctx = await getRequestContext();
  try {
    const address = addressFromForm(formData);
    await saveCheckoutDraft(ctx, {
      address,
      contact: {
        email: String(formData.get("email") ?? "").trim(),
        phone: address.phone,
      },
      // ongkir harus dihitung ulang setelah alamat berubah
      shipping: null,
    });
    if (ctx.user && formData.get("saveToAccount") === "on") {
      // saveAddress memvalidasi dengan addressSchema: landmark berupa string (boleh kosong).
      await saveAddress(ctx, {
        fullName: address.fullName,
        phone: address.phone,
        province: address.province,
        city: address.city,
        district: address.district,
        postalCode: address.postalCode,
        street: address.street,
        landmark: address.landmark ?? "",
        isDefault: false,
      });
    }
  } catch (error) {
    redirect(`${STEPS.alamat}?pesan=${encodeURIComponent(errorTo(error))}`);
  }
  revalidateCheckout();
  redirect(STEPS.pengiriman);
}

export async function chooseShippingAction(formData: FormData): Promise<void> {
  const ctx = await getRequestContext();
  const value = String(formData.get("service") ?? "");
  const [carrierCode, serviceCode] = value.includes("|")
    ? value.split("|")
    : [String(formData.get("carrier") ?? "any"), value];
  try {
    if (!serviceCode) {
      await clearShippingSelection(ctx);
    } else {
      await selectShipping(ctx, { carrierCode: carrierCode || "any", serviceCode });
    }
  } catch (error) {
    redirect(`${STEPS.pengiriman}?pesan=${encodeURIComponent(errorTo(error))}`);
  }
  revalidateCheckout();
  redirect(STEPS.pembayaran);
}

export async function choosePaymentAction(formData: FormData): Promise<void> {
  const ctx = await getRequestContext();
  const code = String(formData.get("method") ?? "");
  const names: Record<string, string> = {
    sim_va: "Virtual Account (Simulasi)",
    sim_qris: "QRIS (Simulasi)",
    sim_card: "Kartu (Simulasi)",
  };
  if (!names[code])
    redirect(`${STEPS.pembayaran}?pesan=${encodeURIComponent("Pilih metode pembayaran.")}`);
  try {
    await saveCheckoutDraft(ctx, { payment: { methodCode: code, methodName: names[code]! } });
  } catch (error) {
    redirect(`${STEPS.pembayaran}?pesan=${encodeURIComponent(errorTo(error))}`);
  }
  revalidateCheckout();
  redirect(STEPS.review);
}

export async function placeOrderAction(formData: FormData): Promise<void> {
  const ctx = await getRequestContext();
  const terms = formData.get("terms");
  const marketing = formData.get("marketing") === "on";
  try {
    if (terms !== "on") {
      throw new AppError("VALIDATION_FAILED", "Setujui syarat & ketentuan untuk melanjutkan.", {
        status: 422,
      });
    }
    // Kunci idempoten terikat keranjang: klik ganda atau retry jaringan mengembalikan order yang sama.
    const cart = await getCartView(ctx);
    if (cart.isEmpty) throw new AppError("CART_EMPTY", "Keranjang masih kosong.", { status: 422 });
    await saveCheckoutDraft(ctx, {
      termsAcceptedAt: new Date().toISOString(),
      marketingConsent: marketing,
    });
    const order = await createOrder(ctx, { idempotencyKey: `cart-${cart.cartId}` });
    redirect(
      `/konfirmasi?pesanan=${encodeURIComponent(order.orderNumber)}&token=${encodeURIComponent(order.trackingToken)}`,
    );
  } catch (error) {
    redirect(`${STEPS.review}?pesan=${encodeURIComponent(errorTo(error))}`);
  }
}

export async function clearShippingAction(): Promise<void> {
  const ctx = await getRequestContext();
  await clearShippingSelection(ctx);
  revalidateCheckout();
  redirect(STEPS.pengiriman);
}
