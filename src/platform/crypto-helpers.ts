import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256(value: string): Promise<string> {
  return Promise.resolve(createHash("sha256").update(value).digest("hex"));
}

export function hmacSha256(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function verifyHmac(secret: string, value: string, provided: string): boolean {
  const expected = hmacSha256(secret, value);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided || "");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Hash untuk token publik (cart token, reset token) supaya nilai mentah tidak disimpan. */
export function hashOpaque(value: string): string {
  return createHmac("sha256", "ndre-gstore-token-hash").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Penyimpanan rahasia MFA / token sensitif di kolom DB (Blueprint §13.3):
 * AES-256-GCM dengan kunci yang diturunkan dari AUTH_SECRET. Format: "v1:<iv>:<tag>:<cipher>" (base64url).
 */
import { createCipheriv, createDecipheriv } from "node:crypto";

async function secretKey(): Promise<Buffer> {
  return Buffer.from(
    await sha256(`${process.env.AUTH_SECRET ?? "dev-secret-change-me"}.enc`),
    "hex",
  );
}

export async function encryptSecret(plain: string): Promise<string> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await secretKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(":");
}

export async function decryptSecret(payload: string): Promise<string> {
  const [version, iv, tag, data] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Format rahasia tidak dikenal");
  const decipher = createDecipheriv("aes-256-gcm", await secretKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
