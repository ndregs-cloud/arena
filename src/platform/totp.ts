/**
 * TOTP RFC 6238 untuk MFA staf/admin (Blueprint §3.1 "MFA untuk administrator dan peran berisiko").
 * Implementasi lokal (HMAC-SHA1, 6 digit, 30 detik) - tanpa layanan pihak ketiga sehingga dapat
 * diverifikasi di CI. Menukar kode dengan verifier TOTP standar (Google Authenticator dll).
 */

import { createHmac, randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, "").toUpperCase().replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(
  secretBase32: string,
  at: Date = new Date(),
  stepSeconds = 30,
  digits = 6,
): string {
  const counter = Math.floor(at.getTime() / 1000 / stepSeconds);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export interface TotpVerifyOptions {
  stepSeconds?: number;
  /** jendela toleransi: jumlah step ke depan/belakang (max 2 sesuai NIST). */
  window?: number;
  at?: Date;
}

export function verifyTotp(
  secretBase32: string,
  code: string,
  options: TotpVerifyOptions = {},
): boolean {
  const step = options.stepSeconds ?? 30;
  const window = Math.min(2, Math.max(0, options.window ?? 1));
  const at = options.at ?? new Date();
  const normalized = code.replace(/\D/g, "");
  if (normalized.length !== 6) return false;
  for (let drift = -window; drift <= window; drift += 1) {
    const candidate = totpCode(secretBase32, new Date(at.getTime() + drift * step * 1000), step);
    if (candidate === normalized) return true;
  }
  return false;
}

export function totpProvisioningUri(
  secret: string,
  email: string,
  issuer = "ndre.gstore (NOVA STORE)",
): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
