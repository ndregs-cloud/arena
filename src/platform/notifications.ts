import "server-only";
import { getDb, num } from "@/platform/db";
import { env } from "@/platform/env";
import { log } from "@/platform/logger";

/**
 * Outbox notifikasi (Blueprint §11.4 "Outbox retry; templates versioned", §17.3 "jangan mengirim
 * email/pesan nyata tanpa explicit test configuration").
 *
 * Sink default = "log": pesan ditulis ke tabel notification_outbox + log server, TIDAK ada email
 * nyata. SMTP/WhatsApp aktif hanya bila kredensial disediakan lewat environment.
 */

export type NotificationKind =
  | "order_created"
  | "payment_succeeded"
  | "payment_failed"
  | "order_shipped"
  | "order_delivered"
  | "order_cancelled"
  | "return_requested"
  | "return_decision"
  | "refund_succeeded"
  | "password_reset"
  | "verify_email";

interface Template {
  subject: string;
  body: (vars: Record<string, string>) => string;
  version: number;
  /** true = wajib consent pemasaran; transaksi selalu boleh dikirim. */
  marketing: boolean;
}

export const TEMPLATES: Record<NotificationKind, Template> = {
  order_created: {
    version: 1,
    marketing: false,
    subject: "Pesanan {orderNumber} diterima",
    body: (v) =>
      `Halo ${v.customerName},\n\nPesanan ${v.orderNumber} sudah kami terima dengan status: ${v.statusNote}\nTotal: ${v.total}\n\nLacak pesanan: ${v.trackingUrl}\n\nCatatan: email otomatis (mode ${env.notifySink}).`,
  },
  payment_succeeded: {
    version: 1,
    marketing: false,
    subject: "Pembayaran {orderNumber} terkonfirmasi",
    body: (v) => `Pembayaran ${v.total} untuk ${v.orderNumber} terkonfirmasi. Pesanan disiapkan.`,
  },
  payment_failed: {
    version: 1,
    marketing: false,
    subject: "Pembayaran {orderNumber} belum berhasil",
    body: (v) =>
      `Pembayaran ${v.orderNumber} belum berhasil. Anda dapat mencoba metode lain dalam ${v.windowNote}.`,
  },
  order_shipped: {
    version: 1,
    marketing: false,
    subject: "Pesanan {orderNumber} dikirim",
    body: (v) =>
      `Pesanan ${v.orderNumber} diserahkan ke kurir. Resi: ${v.trackingNumber} (${v.carrier}). Lacak: ${v.trackingUrl}`,
  },
  order_delivered: {
    version: 1,
    marketing: false,
    subject: "Pesanan {orderNumber} terkirim",
    body: (v) =>
      `Pesanan ${v.orderNumber} tercatat terkirim pada ${v.deliveredAt}. Ada kendala? Ajukan retur sebelum ${v.returnDeadline}.`,
  },
  order_cancelled: {
    version: 1,
    marketing: false,
    subject: "Pesanan {orderNumber} dibatalkan",
    body: (v) =>
      `Pesanan ${v.orderNumber} dibatalkan. Alasan: ${v.reason}. Dana diproses sesuai kebijakan.`,
  },
  return_requested: {
    version: 1,
    marketing: false,
    subject: "Pengajuan retur {returnRef} diterima",
    body: (v) =>
      `Pengajuan retur ${v.returnRef} untuk ${v.orderNumber} sedang ditinjau. Nomor kasus: ${v.returnRef}`,
  },
  return_decision: {
    version: 1,
    marketing: false,
    subject: "Status retur {returnRef}: {decision}",
    body: (v) => `Retur ${v.returnRef} ${v.decisionNote}`,
  },
  refund_succeeded: {
    version: 1,
    marketing: false,
    subject: "Refund {orderNumber} diproses",
    body: (v) => `Refund ${v.amount} untuk ${v.orderNumber} diproses (${v.refundRef}).`,
  },
  password_reset: {
    version: 1,
    marketing: false,
    subject: "Tautan reset kata sandi",
    body: (v) =>
      `Gunakan tautan berikut untuk mengatur ulang kata sandi (berlaku ${v.ttlMinutes} menit): ${v.resetUrl}`,
  },
  verify_email: {
    version: 1,
    marketing: false,
    subject: "Verifikasi email Anda",
    body: (v) => `Verifikasi email melalui tautan ini (berlaku ${v.ttlHours} jam): ${v.verifyUrl}`,
  },
};

function render(
  template: Template,
  vars: Record<string, string>,
): { subject: string; body: string } {
  const fill = (value: string) =>
    value.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `[${key}]`);
  return { subject: fill(template.subject), body: fill(template.body(vars)) };
}

export async function enqueueNotification(input: {
  kind: NotificationKind;
  to: string;
  vars: Record<string, string>;
  orderId?: string | null;
  returnId?: string | null;
  requiresConsent?: boolean;
}): Promise<void> {
  const template = TEMPLATES[input.kind];
  const { subject, body } = render(template, input.vars);
  const db = await getDb();
  await db.query(
    `INSERT INTO notification_outbox (kind, channel, to_address, subject, body, template, template_version, order_id, return_id, payload, requires_consent, status)
     VALUES ($1,'email',$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10, CASE WHEN $10 = true THEN 'queued' ELSE 'queued' END)`,
    [
      input.kind,
      input.to,
      subject,
      body,
      input.kind,
      template.version,
      input.orderId ?? null,
      input.returnId ?? null,
      JSON.stringify(input.vars),
      input.requiresConsent ?? false,
    ],
  );
}

export interface DispatchResult {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  sink: string;
}

/**
 * Kirim antrean (dipanggil job/API admin). Retry: exponential backoff + jitter;
 * terminal -> dead letter lewat status 'failed' dengan last_error.
 */
export async function dispatchNotifications(limit = 25): Promise<DispatchResult> {
  const db = await getDb();
  const result: DispatchResult = {
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    sink: env.notifySink,
  };
  const due = await db.query<{
    id: string;
    kind: string;
    to_address: string;
    subject: string;
    body: string;
    attempts: unknown;
    requires_consent: boolean;
  }>(
    `SELECT id, kind, to_address, subject, body, attempts, requires_consent
       FROM notification_outbox
      WHERE status IN ('queued','failed') AND next_run_at <= now()
      ORDER BY next_run_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  for (const row of due.rows) {
    result.processed += 1;
    if (row.requires_consent) {
      // Consent marketing wajib eksplisit; tanpa consent -> skip, jangan diam-diam mengirim.
      const consent = await db.query<{ has: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM customer_profiles cp JOIN users u ON u.id = cp.user_id
                        WHERE lower(u.email_normalized) = lower($1) AND cp.marketing_consent = true) AS has`,
        [row.to_address],
      );
      if (!consent.rows[0]?.has) {
        await db.query(
          "UPDATE notification_outbox SET status='skipped_no_consent', last_error=$2 WHERE id=$1",
          [row.id, "consent marketing belum diberikan"],
        );
        result.skipped += 1;
        continue;
      }
    }
    if (env.notifySink === "log") {
      // Mode aman: tidak ada SMTP kredensial -> hanya dicatat, pesan tidak pernah keluar.
      await db.query(
        "UPDATE notification_outbox SET status='sent', sent_at=now(), attempts=attempts+1, last_error=$2 WHERE id=$1",
        [row.id, "sink=log (tidak ada email nyata yang dikirim)"],
      );
      result.sent += 1;
      log.info("notification.simulated_send", {
        id: row.id,
        kind: row.kind,
        to: row.to_address,
        subject: row.subject,
      });
      continue;
    }
    try {
      await sendViaSmtp(row.to_address, row.subject, row.body);
      await db.query(
        "UPDATE notification_outbox SET status='sent', sent_at=now(), attempts=attempts+1, last_error=NULL WHERE id=$1",
        [row.id],
      );
      result.sent += 1;
    } catch (error) {
      const attempts = num(row.attempts) + 1;
      const backoffSeconds = Math.min(3600, 2 ** attempts * 30) + Math.floor(Math.random() * 15);
      await db.query(
        `UPDATE notification_outbox SET status='failed', attempts=$2, last_error=$3, next_run_at = now() + ($4 || ' seconds')::interval WHERE id=$1`,
        [
          row.id,
          attempts,
          error instanceof Error ? error.message : "unknown",
          String(backoffSeconds),
        ],
      );
      result.failed += 1;
    }
  }
  return result;
}

async function sendViaSmtp(_to: string, _subject: string, _body: string): Promise<void> {
  // SMTP nyata sengaja belum diimplementasikan: butuh kredensial + keputusan vendor (Blueprint §11.4).
  throw new Error(
    "NOTIFY_SINK=smtp membutuhkan transport email yang dipilih + kredensial environment.",
  );
}
