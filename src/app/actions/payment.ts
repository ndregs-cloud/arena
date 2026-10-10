"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/domain/errors";
import { getDb, num, text } from "@/platform/db";
import { env } from "@/platform/env";
import { hmacSha256 } from "@/platform/crypto-helpers";
import { paymentProvider } from "@/platform/payment";
import { getRequestContext } from "@/server/context";
import {
  handleBrowserReturn,
  ingestPaymentWebhook,
  initiatePayment,
} from "@/server/services/payment.service";

/**
 * Aksi pembayaran untuk pelanggan (tamu memakai tracking token sebagai kemampuan akses).
 * Tidak ada jalur yang menandai lunas dari browser: status berubah hanya lewat respons API
 * provider atau webhook terverifikasi (AT-05). Tombol "simulasi" hanya hidup saat adapter
 * simulasi aktif dan bukan di produksi.
 */

export interface PayState {
  status: string | null;
  message: string;
  instructions: string | null;
  redirectUrl: string | null;
  isSimulated: boolean;
}

const IDLE: PayState = {
  status: null,
  message: "",
  instructions: null,
  redirectUrl: null,
  isSimulated: true,
};

function messageFor(error: unknown): string {
  return error instanceof AppError
    ? error.message
    : "Status pembayaran belum bisa diambil. Coba lagi sebentar.";
}

async function loadAttemptFor(
  orderNumber: string,
  token: string,
): Promise<{ attemptId: string; orderId: string; amount: number; providerRef: string | null }> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT o.id AS order_id, pa.id AS attempt_id, pa.amount, pa.provider_ref
       FROM orders o JOIN payment_attempts pa ON pa.order_id = o.id
      WHERE o.order_number = $1 AND ($2 = '' OR o.tracking_token = $2)
      ORDER BY pa.created_at DESC LIMIT 1`,
    [orderNumber, token],
  );
  const row = res.rows[0];
  if (!row)
    throw new AppError("NOT_FOUND", "Data pembayaran tidak ditemukan untuk tautan ini.", {
      status: 404,
    });
  return {
    attemptId: text(row.attempt_id),
    orderId: text(row.order_id),
    amount: num(row.amount),
    providerRef: row.provider_ref ? text(row.provider_ref) : null,
  };
}

export async function startPaymentAction(payload: {
  orderNumber: string;
  token: string;
  scenario?: string;
}): Promise<PayState> {
  const ctx = await getRequestContext();
  try {
    const { attemptId } = await loadAttemptFor(payload.orderNumber, payload.token);
    const result = await initiatePayment(ctx, attemptId, { simScenario: payload.scenario });
    revalidatePath(`/konfirmasi`);
    return {
      status: result.status,
      message:
        result.status === "succeeded"
          ? "Pembayaran terkonfirmasi. Pesanan sedang disiapkan."
          : result.status === "failed"
            ? "Pembayaran ditolak. Anda dapat mencoba metode lain."
            : "Instruksi pembayaran siap. Status akan diperbarui otomatis saat pembayaran terkonfirmasi.",
      instructions: result.instructions,
      redirectUrl: result.redirectUrl,
      isSimulated: result.isSimulated,
    };
  } catch (error) {
    return { ...IDLE, message: messageFor(error) };
  }
}

export async function refreshPaymentStatusAction(payload: {
  orderNumber: string;
  token: string;
}): Promise<PayState> {
  const ctx = await getRequestContext();
  try {
    const { attemptId } = await loadAttemptFor(payload.orderNumber, payload.token);
    const result = await handleBrowserReturn(ctx, attemptId);
    revalidatePath("/pesanan");
    return {
      status: result.status,
      message: result.message,
      instructions: null,
      redirectUrl: null,
      isSimulated: true,
    };
  } catch (error) {
    return { ...IDLE, message: messageFor(error) };
  }
}

/** Hanya untuk sandbox lokal: mengirim webhook bertanda tangan ke jalur produksi. */
export async function simulateProviderEventAction(payload: {
  orderNumber: string;
  token: string;
  kind: string;
  duplicate?: boolean;
}): Promise<PayState> {
  if (process.env.NODE_ENV === "production" || !env.isEmbeddedDatabase) {
    return { ...IDLE, message: "Konsol simulasi dinonaktifkan di lingkungan ini." };
  }
  const provider = paymentProvider();
  if (!provider.isSimulated)
    return { ...IDLE, message: "Adapter provider aktif bukan simulasi; aksi ini dimatikan." };
  const ctx = await getRequestContext({ createCartToken: false });
  try {
    const { providerRef, amount } = await loadAttemptFor(payload.orderNumber, payload.token);
    if (!providerRef)
      return {
        ...IDLE,
        message: "Attempt belum punya referensi provider. Buka halaman pembayaran lebih dulu.",
      };
    const body = JSON.stringify({
      event_id: `evt-sim-${payload.kind}-${Math.random().toString(36).slice(2, 10)}`,
      event_type: payload.kind,
      provider_ref: providerRef,
      amount,
      currency: "IDR",
      occurred_at: new Date().toISOString(),
    });
    const signature = await hmacSha256(env.mockWebhookSecret, body);
    const first = await ingestPaymentWebhook(body, signature, ctx);
    let second: string | null = null;
    if (payload.duplicate) {
      const again = await ingestPaymentWebhook(body, signature, ctx);
      second = again.outcome;
    }
    revalidatePath("/konfirmasi");
    return {
      status: null,
      message: `Webhook ${payload.kind}: ${first.outcome}${second ? ` · pengulangan: ${second}` : ""}`,
      instructions: null,
      redirectUrl: null,
      isSimulated: true,
    };
  } catch (error) {
    return { ...IDLE, message: messageFor(error) };
  }
}
