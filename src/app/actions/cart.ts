"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@/domain/errors";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";
import { getRequestContext } from "@/server/context";
import {
  addToCart,
  applyCoupon,
  removeCartLine,
  removeCoupon,
  updateCartLineQuantity,
} from "@/server/services/cart.service";

/**
 * Server actions keranjang. UI tidak pernah mengirim harga/total - hanya id varian, kuantitas,
 * dan kode kupon; semuanya dihitung ulang oleh service (Blueprint §5.3, AT-03).
 */

function fail(error: unknown): FormState {
  if (error instanceof AppError) return { message: error.message, tone: "danger" };
  if (error instanceof Error && error.message.includes("redirect")) throw error;
  return {
    message: "Permintaan tidak dapat diproses. Muat ulang halaman lalu coba lagi.",
    tone: "danger",
  };
}

function revalidateCart() {
  revalidatePath("/keranjang");
  revalidatePath("/checkout/alamat");
  revalidatePath("/checkout/pengiriman");
  revalidatePath("/checkout/pembayaran");
  revalidatePath("/checkout/review");
  revalidatePath("/");
}

export async function addToCartAction(state: FormState, formData: FormData): Promise<FormState> {
  void state;
  const variantId = String(formData.get("variantId") ?? "");
  const quantity = Number(formData.get("quantity") ?? 1);
  const redirectTo = formData.get("redirect");
  if (!variantId) return { message: "Varian produk belum dipilih.", tone: "danger" };
  try {
    const ctx = await getRequestContext();
    const result = await addToCart(ctx, variantId, Number.isFinite(quantity) ? quantity : 1);
    revalidateCart();
    if (redirectTo === "cart") redirect("/keranjang");
    return { message: result.message, tone: "success" };
  } catch (error) {
    return fail(error);
  }
}

export async function updateCartLineAction(formData: FormData): Promise<void> {
  const cartItemId = String(formData.get("cartItemId") ?? "");
  const quantity = Number(formData.get("quantity") ?? 1);
  const ctx = await getRequestContext();
  try {
    await updateCartLineQuantity(ctx, cartItemId, Number.isFinite(quantity) ? quantity : 1);
  } catch (error) {
    if (error instanceof AppError)
      redirect(`/keranjang?pesan=${encodeURIComponent(error.message)}`);
    throw error;
  }
  revalidateCart();
}

export async function removeCartLineAction(formData: FormData): Promise<void> {
  const cartItemId = String(formData.get("cartItemId") ?? "");
  const ctx = await getRequestContext();
  try {
    await removeCartLine(ctx, cartItemId);
  } catch (error) {
    if (error instanceof AppError)
      redirect(`/keranjang?pesan=${encodeURIComponent(error.message)}`);
    throw error;
  }
  revalidateCart();
}

export async function applyCouponAction(state: FormState, formData: FormData): Promise<FormState> {
  void state;
  const code = String(formData.get("coupon") ?? "").trim();
  if (!code) return { message: "Masukkan kode promo terlebih dahulu.", tone: "danger" };
  const ctx = await getRequestContext();
  try {
    const result = await applyCoupon(ctx, code);
    revalidateCart();
    return { message: result.message ?? `Kode ${code} aktif.`, tone: "success" };
  } catch (error) {
    return fail(error);
  }
}

export async function removeCouponAction(): Promise<void> {
  const ctx = await getRequestContext();
  await removeCoupon(ctx);
  revalidateCart();
}
