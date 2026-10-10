import "server-only";
import { getDb, text, num, bool, date, optText } from "@/platform/db";

/** Kebijakan toko dengan versi (Blueprint §6.1 "policy version", §4.1). */

export interface PolicyDoc {
  key: string;
  version: number;
  title: string;
  body: string;
  effectiveAt: Date | null;
}

export async function loadCurrentPolicy(key: string): Promise<PolicyDoc | null> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM policies WHERE key = $1 ORDER BY is_current DESC, version DESC LIMIT 1`,
    [key],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    key: text(row.key),
    version: num(row.version),
    title: text(row.title),
    body: text(row.body),
    effectiveAt: date(row.effective_at),
  };
}

export async function loadCurrentPolicyVersion(key: string): Promise<string> {
  const policy = await loadCurrentPolicy(key);
  return policy ? `${policy.key}-v${policy.version}` : "syarat-v1";
}

export async function listCurrentPolicies(): Promise<PolicyDoc[]> {
  const db = await getDb();
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM policies WHERE is_current = true ORDER BY key`,
  );
  return res.rows.map((row) => ({
    key: text(row.key),
    version: num(row.version),
    title: text(row.title),
    body: text(row.body),
    effectiveAt: date(row.effective_at),
    note: optText(row.title),
  })) as PolicyDoc[];
}

export async function isPolicyAcknowledged(email: string, key: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.query<{ found: unknown }>(
    `SELECT EXISTS(SELECT 1 FROM consent_records WHERE lower(email) = lower($1) AND policy_key = $2) AS found`,
    [email, key],
  );
  return bool(res.rows[0]?.found);
}
