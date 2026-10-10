import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, text } from "@/platform/db";
import { isSessionLive } from "@/platform/auth";
import { closeDbForTests, seededDb } from "../helpers/db";
import { makeCtx, makeUser } from "../helpers/test-context";

/**
 * Sesi harus dicabut di server, bukan hanya di hapus cookie (Blueprint §3.1 " sesi dapat dicabut",
 * §13.1). Uji ini mengunci perilaku yang mengembalikan `readSessionCookie()` ke null setelah
 * logout massal / reset kata sandi, meskipun cookie (dan tanda tangannya) masih valid.
 */

let userId = "";

async function newSession(publicId: string, options: { expiresInSeconds?: number } = {}) {
  const db = await getDb();
  const seconds = options.expiresInSeconds ?? 3600;
  await db.query(
    `INSERT INTO sessions (public_id, user_id, expires_at, ip_hash, user_agent)
     VALUES ($1, $2, now() + ($3 || ' seconds')::interval, 'test-ip', 'vitest')`,
    [publicId, userId, String(seconds)],
  );
  return publicId;
}

beforeAll(async () => {
  const { db, summary } = await seededDb();
  const row = await db.query<Record<string, unknown>>(`SELECT id FROM users WHERE email = $1`, [
    "pelanggan@ndre.gstore.test",
  ]);
  userId = text(row.rows[0]?.id);
  expect(userId).toBeTruthy();
  expect(summary.users.length).toBeGreaterThan(0);
});

afterAll(async () => {
  await closeDbForTests();
});

describe("validasi sesi sisi server", () => {
  it("menerima sesi aktif milik pengguna yang cocok", async () => {
    const publicId = await newSession(`live-${Date.now()}`);
    await expect(isSessionLive(publicId, userId)).resolves.toBe(true);
  });

  it("menolak sesi setelah revoked_at di-set (cabut semua perangkat)", async () => {
    const publicId = await newSession(`revoked-${Date.now()}`);
    expect(await isSessionLive(publicId, userId)).toBe(true);

    const db = await getDb();
    await db.query(`UPDATE sessions SET revoked_at = now() WHERE public_id = $1`, [publicId]);

    await expect(isSessionLive(publicId, userId)).resolves.toBe(false);
  });

  it("menolak sesi yang melewati TTL meski belum dicabut", async () => {
    // `sessions` punya CHECK (expires_at > created_at), jadi kedaluwarsa diuji dengan TTL
    // 1 detik yang benar-benar berlalu - bukan dengan menulis tanggal mundur.
    const publicId = await newSession(`ttl-${Date.now()}`, { expiresInSeconds: 1 });
    expect(await isSessionLive(publicId, userId)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    await expect(isSessionLive(publicId, userId)).resolves.toBe(false);
  });

  it("menolak token sesi milik pengguna lain", async () => {
    const publicId = await newSession(`cross-user-${Date.now()}`);
    const db = await getDb();
    const other = await db.query<Record<string, unknown>>(`SELECT id FROM users WHERE email = $1`, [
      "operator@ndre.gstore.test",
    ]);
    const otherId = text(other.rows[0]?.id);
    expect(otherId).toBeTruthy();
    expect(otherId).not.toBe(userId);

    await expect(isSessionLive(publicId, otherId)).resolves.toBe(false);
    await expect(isSessionLive(publicId, userId)).resolves.toBe(true);
  });

  it("pencabutan lewat layanan membuat pengguna kehilangan akses", async () => {
    const db = await getDb();
    const publicId = await newSession(`service-${Date.now()}`);
    const { revokeOtherSessions } = await import("@/server/services/auth.service");
    const ctx = makeCtx({
      user: makeUser({ id: userId, kind: "customer", roles: ["customer"], permissions: [] }),
    });
    const result = await revokeOtherSessions(ctx);
    expect(result.revoked).toBeGreaterThanOrEqual(1);
    expect(await isSessionLive(publicId, userId)).toBe(false);

    const still = await db.query(
      `SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    expect(Number(still.rows[0]?.n ?? 0)).toBe(0);
  });
});
