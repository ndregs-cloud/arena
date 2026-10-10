"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@/domain/errors";
import { getRequestContext } from "@/server/context";
import { cancelOrder, addOrderNote } from "@/server/services/order.service";
import { createReturnRequest } from "@/server/services/return.service";

/** Aksi pelanggan atas ordernya sendiri (service menegakkan kepemilikan + status yang boleh berubah). */

function fail(message: string, back: string): never {
  redirect(`${back}?pesan=${encodeURIComponent(message)}`);
}

function text(error: unknown): string {
  return error instanceof AppError ? error.message : "Permintaan tidak dapat diproses.";
}

export async function cancelOrderAction(formData: FormData): Promise<void> {
  const orderId = String(formData.get("orderId") ?? "");
  const orderNumber = String(formData.get("orderNumber") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const back = `/pesanan/${orderNumber}`;
  if (!reason || reason.length < 5) fail("Tuliskan alasan pembatalan minimal 5 karakter.", back);
  const ctx = await getRequestContext();
  try {
    await cancelOrder(ctx, orderId, reason);
  } catch (error) {
    fail(text(error), back);
  }
  revalidatePath(back);
  redirect(`${back}?pesan=Pesanan+dibatalkan.`);
}

export async function addNoteAction(formData: FormData): Promise<void> {
  const orderId = String(formData.get("orderId") ?? "");
  const orderNumber = String(formData.get("orderNumber") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const ctx = await getRequestContext();
  try {
    if (note.length < 3)
      throw new AppError("VALIDATION_FAILED", "Tulis catatan yang jelas.", { status: 422 });
    await addOrderNote(ctx, orderId, note, "internal");
  } catch (error) {
    fail(text(error), `/pesanan/${orderNumber}`);
  }
  revalidatePath(`/pesanan/${orderNumber}`);
}

export async function createReturnAction(formData: FormData): Promise<void> {
  const orderNumber = String(formData.get("orderNumber") ?? "");
  const back = `/pesanan/${orderNumber}/retur`;
  const lines: Array<{ orderItemId: string; quantity: number; note?: string }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("qty:")) continue;
    const orderItemId = key.slice(4);
    const quantity = Number(value);
    if (Number.isFinite(quantity) && quantity > 0)
      lines.push({ orderItemId, quantity, note: undefined });
  }
  const resolution = String(formData.get("resolution") ?? "refund");
  const ctx = await getRequestContext();
  try {
    if (lines.length === 0)
      throw new AppError("VALIDATION_FAILED", "Pilih minimal satu item untuk diretur.", {
        status: 422,
      });
    const result = await createReturnRequest(ctx, {
      orderNumber,
      reasonCode: String(formData.get("reasonCode") ?? "changed_mind"),
      description: String(formData.get("description") ?? "").trim(),
      resolution:
        resolution === "exchange" || resolution === "store_credit" || resolution === "none"
          ? (resolution as "exchange" | "store_credit" | "none")
          : "refund",
      lines,
      photoRefs: String(formData.get("photos") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    });
    redirect(`/retur/${result.reference}?pesan=${encodeURIComponent(result.message)}`);
  } catch (error) {
    fail(text(error), back);
  }
}
