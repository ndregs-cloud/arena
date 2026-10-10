#!/usr/bin/env node
/**
 * Worker antrian (Blueprint §11.4 "outbox retry", §17.3 "jangan kirim email nyata tanpa
 * konfigurasi test eksplisit").
 *
 * Dua lintasan, keduanya TANPA panggilan jaringan keluar:
 *  1. notification_outbox - dikirim sesuai NOTIFY_SINK. Default `log` = status `sent`
 *     ditandai "simulasi", tidak ada email nyata yang pernah keluar.
 *  2. integration_outbox  - kinds yang butuh provider (webhook keluar, kurir, ERP) TIDAK
 *     dikerjakan di sini; hanya dilaporkan sebagai backlog supaya operator tahu apa yang
 *     menunggu kredensial. Penyelesaian yang aman (fan-out notifikasi status order) tetap jalan.
 *
 * Jalankan: node scripts/process-outbox.mjs [--limit=25] [--once]
 * `--once` (default) = satu siklus lalu keluar; cocok untuk cron.
 */
import { loadEnv, openDb } from "./db-lib.mjs";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = Math.min(200, Math.max(1, Number(limitArg?.split("=")[1] ?? 25)));

const env = { ...(await loadEnv()), ...process.env };
const sink = (env.NOTIFY_SINK ?? "log").toLowerCase();

const db = await openDb({
  driver: env.DATA_DRIVER === "postgres" ? "postgres" : "pglite",
  databaseUrl: env.DATABASE_URL,
  pgliteDir: env.PGLITE_DIR || ".data/pglite",
});

console.log(`ndre.gstore outbox worker - driver=${db.driver} notify-sink=${sink} limit=${LIMIT}`);

const stats = { processed: 0, sent: 0, skipped: 0, failed: 0, fanned: 0 };

try {
  // --- 1. notification_outbox -------------------------------------------------------------
  const due = await db.query(
    `SELECT id, kind, to_address, subject, body, attempts, requires_consent
       FROM notification_outbox
      WHERE status IN ('queued','failed') AND next_run_at <= now()
      ORDER BY next_run_at
      LIMIT $1`,
    [LIMIT],
  );

  for (const row of due.rows) {
    stats.processed += 1;

    if (row.requires_consent) {
      const consent = await db.query(
        `SELECT EXISTS(
           SELECT 1 FROM customer_profiles cp
             JOIN users u ON u.id = cp.user_id
            WHERE lower(u.email_normalized) = lower($1) AND cp.marketing_consent = true
         ) AS has`,
        [row.to_address],
      );
      if (!consent.rows[0]?.has) {
        await db.query(
          `UPDATE notification_outbox
              SET status='skipped_no_consent', last_error=$2
            WHERE id=$1`,
          [row.id, "consent marketing belum diberikan"],
        );
        stats.skipped += 1;
        console.log(`  – #${row.id} ${row.kind}: dilewati (tanpa consent pemasaran)`);
        continue;
      }
    }

    if (sink === "log") {
      await db.query(
        `UPDATE notification_outbox
            SET status='sent', sent_at=now(), attempts=attempts+1, last_error=$2
          WHERE id=$1`,
        [row.id, "sink=log (tidak ada email nyata yang dikirim)"],
      );
      stats.sent += 1;
      console.log(`  ✓ #${row.id} ${row.kind} -> ${row.to_address} [SIMULASI]`);
      continue;
    }

    const attempts = Number(row.attempts ?? 0) + 1;
    const backoffSeconds = Math.min(3600, 2 ** attempts * 30);
    await db.query(
      `UPDATE notification_outbox
          SET status='failed', attempts=$2, last_error=$3,
              next_run_at = now() + ($4 || ' seconds')::interval
        WHERE id=$1`,
      [
        row.id,
        attempts,
        `NOTIFY_SINK=${sink} membutuhkan transport email + kredensial (belum dikonfigurasi)`,
        String(backoffSeconds),
      ],
    );
    stats.failed += 1;
    console.log(
      `  ! #${row.id} ${row.kind}: tetap di antrian (transport email belum dikonfigurasi)`,
    );
  }

  // --- 2. integration_outbox: fan-out aman + laporan backlog ------------------------------
  const FAN_OUT_KIND = "order.notify";
  const integrations = await db.query(
    `SELECT id, kind, destination, payload, attempts, max_attempts, last_error
       FROM integration_outbox
      WHERE status IN ('pending','failed') AND next_run_at <= now()
      ORDER BY next_run_at
      LIMIT $1`,
    [LIMIT],
  );

  let backlog = 0;
  for (const item of integrations.rows) {
    if (item.kind !== FAN_OUT_KIND) {
      backlog += 1;
      continue;
    }
    const payload =
      typeof item.payload === "string" ? JSON.parse(item.payload) : (item.payload ?? {});
    const orderId = payload.orderId ?? payload.order_id;
    const to = payload.to;
    if (!orderId || !to) {
      await failIntegration(db, item.id, item.attempts, item.max_attempts, "payload tidak lengkap");
      continue;
    }
    const orderRes = await db.query(`SELECT order_number, status FROM orders WHERE id=$1`, [
      orderId,
    ]);
    if (!orderRes.rows[0]) {
      await failIntegration(db, item.id, item.attempts, item.max_attempts, "order tidak ditemukan");
      continue;
    }
    await db.query(
      `INSERT INTO notification_outbox
         (kind, channel, to_address, subject, body, template, template_version, order_id, payload, requires_consent, status)
       VALUES ('order_status','email',$1,$2,$3,'order_status',1,$4,'{}'::jsonb,false,'queued')`,
      [
        to,
        `Status pesanan ${orderRes.rows[0].order_number} diperbarui`,
        `Pesanan ${orderRes.rows[0].order_number} kini berstatus ${orderRes.rows[0].status}.`,
        orderId,
      ],
    );
    await db.query(
      `UPDATE integration_outbox SET status='succeeded', finished_at=now(), last_error=NULL WHERE id=$1`,
      [item.id],
    );
    stats.fanned += 1;
    console.log(`  ✓ #${item.id} order.notify: notifikasi status diantrekan`);
  }

  const remaining = await db.query(
    `SELECT status, count(*)::int AS n FROM integration_outbox
      WHERE status IN ('pending','failed','running') GROUP BY status`,
  );
  const summary = remaining.rows.map((r) => `${r.status}=${r.n}`).join(", ") || "kosong";

  console.log(
    `\nnotification: proses=${stats.processed} sent=${stats.sent} skip=${stats.skipped} failed=${stats.failed}`,
  );
  console.log(
    `integrasi   : fan-out=${stats.fanned} menunggu-kredensial=${backlog} antrean[${summary}]`,
  );
  if (sink === "log") {
    console.log("Catatan: tidak ada email/pesan nyata yang dikirim (NOTIFY_SINK=log).");
  }
} catch (error) {
  console.error(
    "OUTBOX GAGAL:",
    error instanceof Error ? error.message : String(error).slice(0, 400),
  );
  process.exitCode = 1;
} finally {
  await db.close();
}

async function failIntegration(db, id, attempts, maxAttempts, message) {
  const next = Number(attempts ?? 0) + 1;
  const max = Number(maxAttempts ?? 8) || 8;
  const final = next >= max ? "dead_letter" : "failed";
  const minutes = Math.min(240, 2 ** Math.min(next, 8) * 5);
  await db.query(
    `UPDATE integration_outbox
        SET status=$2, attempts=$3, last_error=$4, next_run_at = now() + ($5 || ' minutes')::interval,
            finished_at = CASE WHEN $2 <> 'failed' THEN now() ELSE NULL END
      WHERE id=$1`,
    [id, final, next, message, String(minutes)],
  );
  console.log(`  ! #${id}: ${message} -> ${final}`);
}
