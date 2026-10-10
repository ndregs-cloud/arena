"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@/domain/errors";
import { getRequestContext } from "@/server/context";
import { createReview } from "@/server/services/catalog.service";
import type { PrivacyKind } from "@/server/services/account.service";
import {
  createPrivacyRequest,
  deleteAddress,
  saveAddress,
  setDefaultAddress,
  toggleWishlist,
} from "@/server/services/account.service";
import { listAddresses } from "@/server/services/account.service";

/** Aksi akun pelanggan (wishlist, alamat, ulasan). Semuanya memerlukan sesi (requireUser di service). */

function message(error: unknown): string {
  return error instanceof AppError ? error.message : "Permintaan tidak dapat diproses.";
}

export async function toggleWishlistAction(formData: FormData): Promise<void> {
  const productId = String(formData.get("productId") ?? "");
  try {
    const ctx = await getRequestContext();
    const variantId = String(formData.get("variantId") ?? "");
    await toggleWishlist(ctx, productId, variantId || null);
  } catch (error) {
    redirect(
      `/masuk?setelah=${encodeURIComponent("/akun/wishlist")}&pesan=${encodeURIComponent(message(error))}`,
    );
  }
  revalidatePath("/akun/wishlist");
  revalidatePath("/produk/" + String(formData.get("slug") ?? ""));
}

export async function saveAddressAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  const existingId = typeof id === "string" && id.length > 0 ? id : undefined;
  const labelValue = String(formData.get("label") ?? "");
  const payload = {
    fullName: String(formData.get("fullName") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    province: String(formData.get("province") ?? "").trim(),
    city: String(formData.get("city") ?? "").trim(),
    district: String(formData.get("district") ?? "").trim(),
    postalCode: String(formData.get("postalCode") ?? "").trim(),
    street: String(formData.get("street") ?? "").trim(),
    // addressSchema menerima string kosong (bukan null) untuk field opsional.
    landmark: String(formData.get("landmark") ?? "").trim(),
    isDefault: formData.get("isDefault") === "on",
    ...(labelValue === "rumah" || labelValue === "kantor" || labelValue === "lainnya"
      ? { label: labelValue }
      : {}),
  };
  try {
    const ctx = await getRequestContext();
    await saveAddress(ctx, payload, existingId);
  } catch (error) {
    redirect(`/akun/alamat?pesan=${encodeURIComponent(message(error))}`);
  }
  revalidatePath("/akun/alamat");
  revalidatePath("/checkout/alamat");
  redirect("/akun/alamat");
}

export async function deleteAddressAction(formData: FormData): Promise<void> {
  const ctx = await getRequestContext();
  try {
    await deleteAddress(ctx, String(formData.get("id") ?? ""));
  } catch (error) {
    redirect(`/akun/alamat?pesan=${encodeURIComponent(message(error))}`);
  }
  revalidatePath("/akun/alamat");
}

export async function setDefaultAddressAction(formData: FormData): Promise<void> {
  const ctx = await getRequestContext();
  try {
    await setDefaultAddress(ctx, String(formData.get("id") ?? ""));
  } catch (error) {
    redirect(`/akun/alamat?pesan=${encodeURIComponent(message(error))}`);
  }
  revalidatePath("/akun/alamat");
}

export async function useAddressAtCheckoutAction(formData: FormData): Promise<void> {
  const ctx = await getRequestContext();
  const id = String(formData.get("id") ?? "");
  const addresses = await listAddresses(ctx);
  const address = addresses.find((item) => item.id === id);
  if (!address) redirect("/checkout/alamat?pesan=Alamat+tidak+ditemukan");
  const { saveCheckoutDraft } = await import("@/server/services/cart.service");
  await saveCheckoutDraft(ctx, {
    address: {
      fullName: address.fullName,
      phone: address.phone,
      province: address.province,
      city: address.city,
      district: address.district,
      postalCode: address.postalCode,
      street: address.street,
      landmark: address.landmark,
    },
  });
  revalidatePath("/checkout/alamat");
  redirect("/checkout/pengiriman");
}

export async function createReviewAction(formData: FormData): Promise<void> {
  const productId = String(formData.get("productId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const ctx = await getRequestContext();
  try {
    await createReview(
      {
        productId,
        rating: Number(formData.get("rating") ?? 0),
        title: String(formData.get("title") ?? ""),
        body: String(formData.get("body") ?? "") || undefined,
        variantLabel: String(formData.get("variantLabel") ?? "") || undefined,
      },
      ctx,
    );
  } catch (error) {
    redirect(`/produk/${slug}?ulasan=gagal&pesan=${encodeURIComponent(message(error))}`);
  }
  revalidatePath(`/produk/${slug}`);
  redirect(`/produk/${slug}?ulasan=terkirim`);
}

export async function createPrivacyRequestAction(formData: FormData): Promise<void> {
  const kind = String(formData.get("kind") ?? "access");
  const detail = String(formData.get("detail") ?? "").trim();
  const ctx = await getRequestContext();
  try {
    await createPrivacyRequest(ctx, {
      kind:
        kind === "correction" ||
        kind === "deletion" ||
        kind === "portability" ||
        kind === "objection"
          ? (kind as PrivacyKind)
          : "access",
      detail,
    });
  } catch (error) {
    redirect(`/akun/privasi?pesan=${encodeURIComponent(message(error))}`);
  }
  revalidatePath("/akun/privasi");
  redirect("/akun/privasi?pesan=Permintaan+dicatat.+Tim+DPO+akan+menindaklanjuti+sesuai+SLA.");
}
