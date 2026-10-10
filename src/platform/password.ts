import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Hash kata sandi memakai scrypt (tanpa dependensi eksternal). Blueprint §12.1:
 * "jangan menyimpan password mentah". Format tersimpan: scrypt$N$r$p$salt$hash (base64url).
 */

const PARAMS = { N: 16_384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string): string {
  if (password.length < 10)
    throw new Error("Kata sandi terlalu pendek untuk dihash (min. 10 karakter).");
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt",
    String(PARAMS.N),
    String(PARAMS.r),
    String(PARAMS.p),
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(hashB64, "base64url");
    const salt = Buffer.from(saltB64, "base64url");
    actual = scryptSync(password.normalize("NFKC"), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** HMAC pendek untuk tanda tangan cookie sesi & verifikasi signature webhook mock. */
export function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifySignature(secret: string, payload: string, provided: string): boolean {
  const expected = sign(secret, payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided ?? "");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
