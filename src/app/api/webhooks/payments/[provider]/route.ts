import { NextResponse } from "next/server";
import { AppError } from "@/domain/errors";
import { log } from "@/platform/logger";
import { paymentProvider } from "@/platform/payment";
import { getRequestContext } from "@/server/context";
import { ingestPaymentWebhook } from "@/server/services/payment.service";

/**
 * Ingest webhook pembayaran (Blueprint §11.3).
 * - Body dibaca mentah (raw text) karena signature dihitung atas byte persis dari provider.
 * - Signature TIDAK valid -> 401, tidak ada perubahan state.
 * - Event diproses / duplikat / diabaikan -> selalu 200 agar provider tidak melakukan retry
 *   berlebihan; kebutuhan peninjauan manusia ditandai needs_review dan masuk antrean eksepsi.
 * - Kegagalan tak terduga -> 200 + catatan log; rekonsiliasi berkala yang akan membereskan.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await context.params;
  const active = paymentProvider();
  if (provider !== active.code) {
    return NextResponse.json({ ok: false, error: "provider_not_supported" }, { status: 404 });
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ ok: false, error: "unreadable_body" }, { status: 400 });
  }

  const signature =
    request.headers.get("x-signature") ??
    request.headers.get("signature") ??
    request.headers.get("x-webhook-signature");
  const ctx = await getRequestContext({ createCartToken: false });

  try {
    const result = await ingestPaymentWebhook(rawBody, signature, ctx);
    return NextResponse.json(
      { ok: true, outcome: result.outcome, message: result.message },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "PERMISSION_DENIED") {
      log.warn("payment.webhook.rejected", {
        requestId: ctx.requestId,
        reason: "invalid_signature",
      });
      return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
    }
    log.error("payment.webhook.error", error instanceof Error ? error : new Error(String(error)), {
      requestId: ctx.requestId,
    });
    return NextResponse.json({ ok: true, outcome: "received" }, { status: 200 });
  }
}

export async function GET(): Promise<NextResponse> {
  // Endpoint khusus POST; GET mengembalikan 405 tanpa membocorkan detail.
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
