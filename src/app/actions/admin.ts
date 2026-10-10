"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@/domain/errors";
import type { ProductStatus } from "@/domain/catalog";
import type { OrderStatus } from "@/domain/orders";
import { getRequestContext } from "@/server/context";
import {
  addTrackingEvent,
  createShipment,
  transitionOrder,
  addOrderNote,
} from "@/server/services/order.service";
import {
  approveRefund,
  requestRefund,
  settleRefund,
  submitRefund,
} from "@/server/services/payment.service";
import {
  decideReturn,
  inspectReturn,
  receiveReturnItems,
  resolveReturn,
} from "@/server/services/return.service";
import { adjustStock, decideStockAdjustment } from "@/server/services/inventory.service";
import {
  adminCreateProduct,
  adminSetProductStatus,
  adminUpdateProduct,
} from "@/server/services/catalog.service";
import { adminSetPromotionActive, adminUpsertPromotion } from "@/server/services/promotion.service";
import {
  assignUserRole,
  handlePrivacyRequest,
  publishPolicy,
  retryOutboxItem,
  processOutbox,
  revokeUserRole,
  setUserActivation,
  updateSiteSettings,
} from "@/server/services/admin.service";
import type { AdjustmentReason } from "@/domain/inventory";
import type { Promotion } from "@/domain/pricing";

/**
 * Aksi admin center. Semua mutasi lewat service (yang menegakkan permission + invariant),
 * bukan SQL dari UI. Hasil dikembalikan sebagai pesan di URL supaya halaman tetap bisa
 * di-refresh/di-share dan tidak butuh JavaScript.
 */

function back(path: string, message: string, ok = true): never {
  redirect(`${path}?${ok ? "pesan" : "err"}=${encodeURIComponent(message)}`);
}

function message(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function int(formData: FormData, key: string, fallback = 0): number {
  const value = Number(str(formData, key));
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function target(formData: FormData, path: string): string {
  return str(formData, "backTo") || path;
}

export async function transitionOrderAction(formData: FormData): Promise<void> {
  const to = str(formData, "to") as OrderStatus;
  const orderId = str(formData, "orderId");
  const path = target(formData, `/admin/pesanan/${str(formData, "orderNumber")}`);
  const ctx = await getRequestContext();
  try {
    await transitionOrder(ctx, orderId, to, {
      reason: str(formData, "reason") || null,
      note: str(formData, "note") || null,
    });
  } catch (error) {
    back(path, message(error, "Status tidak dapat diubah."), false);
  }
  revalidatePath(path);
  back(path, `Status pesanan diperbarui ke ${to}.`);
}

export async function createShipmentAction(formData: FormData): Promise<void> {
  const orderId = str(formData, "orderId");
  const path = target(formData, `/admin/pesanan/${str(formData, "orderNumber")}`);
  const ctx = await getRequestContext();
  try {
    const result = await createShipment(ctx, orderId, {
      carrierCode: str(formData, "carrierCode"),
      serviceCode: str(formData, "serviceCode"),
      trackingNumber: str(formData, "trackingNumber"),
      packageCount: Math.max(1, int(formData, "packageCount", 1)),
      note: str(formData, "note") || undefined,
      markShipped: formData.get("markShipped") === "on",
    });
    revalidatePath(path);
    back(path, result.message);
  } catch (error) {
    back(path, message(error, "Paket tidak dapat dibuat."), false);
  }
}

export async function addTrackingEventAction(formData: FormData): Promise<void> {
  const shipmentId = str(formData, "shipmentId");
  const path = target(formData, `/admin/pesanan/${str(formData, "orderNumber")}`);
  const ctx = await getRequestContext();
  try {
    const result = await addTrackingEvent(ctx, shipmentId, {
      status: (str(formData, "status") || undefined) as never,
      providerState: str(formData, "providerState") || undefined,
      location: str(formData, "location") || undefined,
      note: str(formData, "note") || undefined,
    });
    revalidatePath(path);
    back(path, result.message);
  } catch (error) {
    back(path, message(error, "Event tracking tidak tercatat."), false);
  }
}

export async function addOrderNoteAction(formData: FormData): Promise<void> {
  const orderId = str(formData, "orderId");
  const path = target(formData, `/admin/pesanan/${str(formData, "orderNumber")}`);
  const ctx = await getRequestContext();
  try {
    await addOrderNote(
      ctx,
      orderId,
      str(formData, "note"),
      str(formData, "visibility") === "customer" ? "customer" : "internal",
    );
  } catch (error) {
    back(path, message(error, "Catatan tidak tersimpan."), false);
  }
  revalidatePath(path);
  back(path, "Catatan tersimpan.");
}

export async function requestRefundAction(formData: FormData): Promise<void> {
  const orderId = str(formData, "orderId");
  const path = target(formData, `/admin/pesanan/${str(formData, "orderNumber")}`);
  const ctx = await getRequestContext();
  try {
    const result = await requestRefund(ctx, {
      orderId,
      amount: int(formData, "amount"),
      reason: str(formData, "reason"),
      includeShipping: formData.get("includeShipping") === "on",
    });
    revalidatePath(path);
    back(path, result.message);
  } catch (error) {
    back(path, message(error, "Refund tidak dapat diajukan."), false);
  }
}

export async function approveRefundAction(formData: FormData): Promise<void> {
  const refundId = str(formData, "refundId");
  const path = target(formData, "/admin/pesanan");
  const decision = str(formData, "decision") === "rejected" ? "rejected" : "approved";
  const ctx = await getRequestContext();
  try {
    const refund = await approveRefund(ctx, refundId, decision, str(formData, "note"));
    if (decision === "approved") {
      await submitRefund(ctx, refund.id);
      // Simulasi: dispatcher menandai selesai; provider nyata menunggu webhook refund.success.
      await settleRefund(ctx, refund.id, { providerConfirmed: false });
    }
    revalidatePath(path);
    back(
      path,
      decision === "approved"
        ? "Refund disetujui, dikirim ke penyedia, dan status diperbarui."
        : "Refund ditolak.",
    );
  } catch (error) {
    back(path, message(error, "Keputusan refund gagal dicatat."), false);
  }
}

export async function decideReturnAction(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const path = target(formData, "/admin/retur");
  const decision = str(formData, "decision") === "rejected" ? "rejected" : "approved";
  const ctx = await getRequestContext();
  try {
    const result = await decideReturn(
      ctx,
      id,
      decision,
      str(formData, "note"),
      formData.get("approvedAmount") ? int(formData, "approvedAmount") : undefined,
    );
    revalidatePath(path);
    back(path, result.message);
  } catch (error) {
    back(path, message(error, "Keputusan retur gagal dicatat."), false);
  }
}

export async function receiveReturnAction(formData: FormData): Promise<void> {
  const id = str(formData, "returnId");
  const path = target(formData, "/admin/retur");
  const ctx = await getRequestContext();
  const received: Array<{ orderItemId: string; quantity: number; damaged?: boolean }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("recv:")) continue;
    const quantity = Number(value);
    if (Number.isFinite(quantity) && quantity > 0)
      received.push({ orderItemId: key.slice(5), quantity: Math.trunc(quantity) });
  }
  try {
    const result = await receiveReturnItems(ctx, id, received);
    revalidatePath(path);
    back(path, result.message);
  } catch (error) {
    back(path, message(error, "Penerimaan barang gagal dicatat."), false);
  }
}

export async function inspectReturnAction(formData: FormData): Promise<void> {
  const id = str(formData, "returnId");
  const path = target(formData, "/admin/retur");
  const ctx = await getRequestContext();
  try {
    const result = await inspectReturn(ctx, id, {
      passed: formData.get("passed") === "on",
      note: str(formData, "note"),
    });
    revalidatePath(path);
    back(path, `${result.message} Barang masuk stok: ${result.restocked}.`);
  } catch (error) {
    back(path, message(error, "Hasil pemeriksaan gagal dicatat."), false);
  }
}

export async function resolveReturnAction(formData: FormData): Promise<void> {
  const id = str(formData, "returnId");
  const path = target(formData, "/admin/retur");
  const ctx = await getRequestContext();
  try {
    const result = await resolveReturn(ctx, id, {
      resolution: (str(formData, "resolution") || "refund") as
        "refund" | "exchange" | "store_credit" | "none",
      note: str(formData, "note"),
    });
    revalidatePath(path);
    back(path, result.message);
  } catch (error) {
    back(path, message(error, "Penyelesaian retur gagal."), false);
  }
}

export async function adjustStockAction(formData: FormData): Promise<void> {
  const path = target(formData, "/admin/inventaris");
  const ctx = await getRequestContext();
  const reason = str(formData, "reason") as AdjustmentReason;
  try {
    const result = await adjustStock(
      {
        sku: str(formData, "sku"),
        locationCode: str(formData, "locationCode") || "MAIN",
        delta: int(formData, "delta"),
        reason,
        note: str(formData, "note") || undefined,
      },
      ctx,
    );
    revalidatePath(path);
    back(path, result.message);
  } catch (error) {
    back(path, message(error, "Penyesuaian stok ditolak."), false);
  }
}

export async function decideStockAdjustmentAction(formData: FormData): Promise<void> {
  const path = target(formData, "/admin/inventaris");
  const ctx = await getRequestContext();
  try {
    await decideStockAdjustment(
      str(formData, "requestId"),
      str(formData, "decision") === "rejected" ? "rejected" : "approved",
      str(formData, "note"),
      ctx,
    );
  } catch (error) {
    back(path, message(error, "Keputusan stok gagal dicatat."), false);
  }
  revalidatePath(path);
  back(path, "Keputusan penyesuaian stok tersimpan.");
}

export async function updateProductAction(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const path = target(formData, `/admin/katalog/${id}`);
  const ctx = await getRequestContext();
  try {
    await adminUpdateProduct(
      {
        id,
        name: str(formData, "name"),
        summary: str(formData, "summary"),
        description: str(formData, "description"),
        brand: str(formData, "brand") || null,
        warranty: str(formData, "warranty") || null,
        careInstructions: str(formData, "careInstructions") || null,
        metaTitle: str(formData, "metaTitle") || null,
        metaDescription: str(formData, "metaDescription") || null,
      },
      ctx,
    );
  } catch (error) {
    back(path, message(error, "Produk tidak tersimpan."), false);
  }
  revalidatePath(path);
  revalidatePath("/admin/katalog");
  back(path, "Perubahan produk tersimpan.");
}

export async function setProductStatusAction(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const status = str(formData, "status") as ProductStatus;
  const path = target(formData, `/admin/katalog/${id}`);
  const ctx = await getRequestContext();
  try {
    await adminSetProductStatus(id, status, ctx, str(formData, "reason") || undefined);
  } catch (error) {
    back(path, message(error, "Status produk tidak berubah."), false);
  }
  revalidatePath(path);
  revalidatePath("/admin/katalog");
  back(path, `Status produk: ${status}.`);
}

export async function upsertPromotionAction(formData: FormData): Promise<void> {
  const path = target(formData, "/admin/promosi");
  const id = str(formData, "id");
  const ctx = await getRequestContext();
  const kind = str(formData, "kind") as Promotion["kind"];
  try {
    await adminUpsertPromotion(
      {
        ...(id ? { id } : {}),
        code: str(formData, "code").toUpperCase(),
        label: str(formData, "label"),
        kind: kind === "percent" || kind === "fixed" || kind === "free_shipping" ? kind : "percent",
        value: int(formData, "value"),
        minSpendAmount: int(formData, "minSpendAmount"),
        discountCapAmount: int(formData, "discountCapAmount") || null,
        startsAt: str(formData, "startsAt"),
        endsAt: str(formData, "endsAt"),
        usageLimit: int(formData, "usageLimit") || null,
        perCustomerLimit: int(formData, "perCustomerLimit") || null,
        stackable: formData.get("stackable") === "on",
        isActive: formData.get("isActive") === "on",
      },
      ctx,
    );
  } catch (error) {
    back(path, message(error, "Promosi tidak tersimpan."), false);
  }
  revalidatePath(path);
  back(path, "Promosi tersimpan.");
}

export async function setPromotionActiveAction(formData: FormData): Promise<void> {
  const path = target(formData, "/admin/promosi");
  const ctx = await getRequestContext();
  try {
    await adminSetPromotionActive(str(formData, "id"), formData.get("isActive") === "on", ctx);
  } catch (error) {
    back(path, message(error, "Status promosi tidak berubah."), false);
  }
  revalidatePath(path);
  back(path, "Status promosi diperbarui.");
}

export async function assignRoleAction(formData: FormData): Promise<void> {
  const path = target(formData, "/admin/pengguna");
  const ctx = await getRequestContext();
  try {
    const result = await assignUserRole(
      ctx,
      str(formData, "userId"),
      str(formData, "role") as never,
    );
    revalidatePath(path);
    back(path, result.message);
  } catch (error) {
    back(path, message(error, "Penugasan role gagal."), false);
  }
}

export async function revokeRoleAction(formData: FormData): Promise<void> {
  const path = target(formData, "/admin/pengguna");
  const ctx = await getRequestContext();
  try {
    const result = await revokeUserRole(
      ctx,
      str(formData, "userId"),
      str(formData, "role") as never,
    );
    revalidatePath(path);
    back(path, result.message);
  } catch (error) {
    back(path, message(error, "Pencabutan role gagal."), false);
  }
}

export async function setUserActiveAction(formData: FormData): Promise<void> {
  const path = target(formData, "/admin/pengguna");
  const ctx = await getRequestContext();
  const active = formData.get("isActive") === "on";
  try {
    const result = await setUserActivation(
      ctx,
      str(formData, "userId"),
      active,
      str(formData, "reason") ||
        (active ? "Akun diaktifkan kembali." : "Akun dinonaktifkan oleh admin."),
    );
    revalidatePath(path);
    back(path, result.message);
  } catch (error) {
    back(path, message(error, "Status akun tidak berubah."), false);
  }
}

export async function updateSettingsAction(formData: FormData): Promise<void> {
  const path = target(formData, "/admin/pengaturan");
  const ctx = await getRequestContext();
  const patch: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("setting:"))
      patch[key.slice(8)] = value === "on" ? true : value === "off" ? false : String(value);
  }
  try {
    const result = await updateSiteSettings(ctx, patch);
    revalidatePath(path);
    back(path, result.message);
  } catch (error) {
    back(path, message(error, "Pengaturan tidak tersimpan."), false);
  }
}

export async function publishPolicyAction(formData: FormData): Promise<void> {
  const path = target(formData, "/admin/pengaturan");
  const ctx = await getRequestContext();
  try {
    const result = await publishPolicy(ctx, {
      key: str(formData, "key"),
      title: str(formData, "title"),
      body: str(formData, "body"),
    });
    revalidatePath(path);
    back(path, result.message);
  } catch (error) {
    back(path, message(error, "Kebijakan tidak dapat diterbitkan."), false);
  }
}

export async function runOutboxAction(formData: FormData): Promise<void> {
  const path = target(formData, "/admin");
  const ctx = await getRequestContext();
  try {
    const id = str(formData, "id");
    if (id) {
      const result = await retryOutboxItem(ctx, Number(id));
      revalidatePath(path);
      back(path, result.message);
    }
    const summary = await processOutbox(ctx, 25);
    revalidatePath(path);
    back(
      path,
      `Outbox: ${summary.processed} diproses, ${summary.succeeded} sukses, ${summary.failed} gagal, ${summary.deferred} ditunda.`,
    );
  } catch (error) {
    back(path, message(error, "Antrean outbox gagal dijalankan."), false);
  }
}

/** Jalankan pekerjaan terjadwal (rekonsiliasi & kedaluwarsa) manual dari dasbor - idempoten. */
export async function runScheduledJobsAction(): Promise<void> {
  const ctx = await getRequestContext();
  try {
    const { reconcileOpenAttempts, expireUnpaidOrders } =
      await import("@/server/services/payment.service");
    const { expireReservations } = await import("@/server/services/inventory.service");
    const reconciliation = await reconcileOpenAttempts(50);
    const expired = await expireUnpaidOrders();
    const reservations = await expireReservations();
    await processOutbox(ctx, 25);
    revalidatePath("/admin");
    back(
      "/admin",
      `Rekonsiliasi: ${reconciliation.checked} attempt diperiksa, ${reconciliation.settled} terselesaikan, ${reconciliation.exceptions} eksepsi · ${expired.orders} order kedaluwarsa · ${reservations.released} reservasi dilepas.`,
    );
  } catch (error) {
    back("/admin", message(error, "Pekerjaan terjadwal gagal."), false);
  }
}

export async function createProductAction(formData: FormData): Promise<void> {
  const ctx = await getRequestContext();
  try {
    const created = await adminCreateProduct(
      {
        name: str(formData, "name"),
        sku: str(formData, "sku"),
        summary: str(formData, "summary") || undefined,
        description: str(formData, "description"),
        status: (str(formData, "status") || "draft") as ProductStatus,
        categoryId: str(formData, "categoryId"),
        brand: str(formData, "brand") || null,
        variants: [
          {
            sku: str(formData, "variantSku") || str(formData, "sku"),
            label: str(formData, "variantLabel") || undefined,
            priceAmount: int(formData, "priceAmount"),
            compareAtAmount: int(formData, "compareAtAmount") || null,
            stockQuantity: int(formData, "stockQuantity", 0),
            lowStockThreshold: int(formData, "lowStockThreshold", 3),
            safetyStock: int(formData, "safetyStock", 0),
            trackInventory: true,
            isActive: true,
          },
        ],
      },
      ctx,
    );
    revalidatePath("/admin/katalog");
    back(
      `/admin/katalog/${created.id}`,
      `Produk dibuat dengan slug ${created.slug}. Tambahkan media & varian lain sebelum dipublikasikan.`,
    );
  } catch (error) {
    back("/admin/katalog/baru", message(error, "Produk tidak dapat dibuat."), false);
  }
}

export async function handlePrivacyRequestAction(formData: FormData): Promise<void> {
  const path = target(formData, "/admin/pelanggan");
  const ctx = await getRequestContext();
  try {
    const decision = str(formData, "decision");
    const result = await handlePrivacyRequest(
      ctx,
      str(formData, "id"),
      decision === "completed" || decision === "rejected"
        ? (decision as "completed" | "rejected")
        : "in_progress",
      str(formData, "note"),
    );
    revalidatePath(path);
    back(path, result.message);
  } catch (error) {
    back(path, message(error, "Permintaan data pribadi tidak dapat diperbarui."), false);
  }
}
