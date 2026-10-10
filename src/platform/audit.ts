import "server-only";
import { getDb } from "@/platform/db";

/**
 * Audit trail append-only (Blueprint §3.1, §8, §12.3).
 * Mencatat actor, aksi, target, before/after, alasan, request ID, dan sumber aksi.
 * Nilai sensitif disaring lewat allow-list field oleh pemanggil; jangan log PII berlebihan.
 */

export interface AuditInput {
  actorId?: string | null;
  actorEmail?: string | null;
  actorKind?: "customer" | "guest" | "staff" | "system" | "job";
  action: string;
  targetType: string;
  targetId?: string | null;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  reason?: string | null;
  requestId?: string | null;
  ipHash?: string | null;
}

const REDACTED_KEYS =
  /^(password|password_hash|token|secret|cvv|pan|card|session|cookie|authorization|mfa_secret.*|totp.*)$/i;

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 25).map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.test(k) ? "[redacted]" : scrub(v);
    }
    return out;
  }
  return value;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO audit_logs (actor_id, actor_email, actor_kind, action, target_type, target_id, before_data, after_data, reason, request_id, ip_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      input.actorId ?? null,
      input.actorEmail ?? null,
      input.actorKind ?? "staff",
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.beforeData ? JSON.stringify(scrub(input.beforeData)) : null,
      input.afterData ? JSON.stringify(scrub(input.afterData)) : null,
      input.reason ?? null,
      input.requestId ?? null,
      input.ipHash ?? null,
    ],
  );
}

export interface AuditQuery {
  targetType?: string;
  targetId?: string;
  actorId?: string;
  limit?: number;
  cursor?: number;
}

export async function listAudit(query: AuditQuery) {
  const db = await getDb();
  const limit = Math.min(200, Math.max(1, query.limit ?? 50));
  const res = await db.query<Record<string, unknown>>(
    `SELECT id, actor_email, actor_kind, action, target_type, target_id, reason, request_id, created_at, before_data, after_data
       FROM audit_logs
      WHERE ($1::text IS NULL OR target_type = $1)
        AND ($2::text IS NULL OR target_id = $2)
        AND ($3::uuid IS NULL OR actor_id = $3)
        AND ($4::bigint IS NULL OR id < $4)
      ORDER BY id DESC
      LIMIT $5`,
    [
      query.targetType ?? null,
      query.targetId ?? null,
      query.actorId ?? null,
      query.cursor ?? null,
      limit + 1,
    ],
  );
  const rows = res.rows.slice(0, limit);
  return {
    rows,
    nextCursor: res.rows.length > limit ? String(rows[rows.length - 1]?.id ?? "") : null,
  };
}
