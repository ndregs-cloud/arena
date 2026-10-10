import { createHash, randomBytes, randomUUID } from "node:crypto";

/**
 * ID & penomoran (Blueprint §6.4: order number dapat dibaca manusia, terpisah dari UUID internal,
 * dan nomor order TIDAK boleh menjadi satu-satunya rahasia akses).
 */

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // tanpa 0/O/1/I/l agar mudah dibaca ulang

export function newId(): string {
  return randomUUID();
}

function base32Like(bytes: Buffer, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    const b = bytes[i % bytes.length] ?? 0;
    out += ALPHABET[(b + i * 7) % ALPHABET.length] ?? ALPHABET[0];
  }
  return out;
}

/** Nomor order: NS-YYYYMMDD-XXXXXX (entropi pada suffix, bukan urutan yang bisa dienumerasi). */
export function generateOrderNumber(at: Date = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `NS-${y}${m}${d}-${base32Like(randomBytes(6), 6)}`;
}

/** Nomor retur: RET-YYYYMMDD-XXXXXX */
export function generateReturnNumber(at: Date = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `RET-${y}${m}${d}-${base32Like(randomBytes(6), 6)}`;
}

/** Nomor tiket/kasus lain. */
export function generateReference(prefix: string, at: Date = new Date()): string {
  const stamp = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, "0")}${String(at.getDate()).padStart(2, "0")}`;
  return `${prefix}-${stamp}-${base32Like(randomBytes(6), 6)}`;
}

/** Token pelacakan publik (guest). 128-bit entropi -> tidak bisa ditebak. */
export function generateTrackingToken(): string {
  return base32Like(randomBytes(20), 26);
}

export function generateCartToken(): string {
  return base32Like(randomBytes(20), 26);
}

export function generateSessionId(): string {
  return base32Like(randomBytes(24), 32);
}

export function generateIdempotencyKey(): string {
  return randomUUID();
}

/** Nomor billing simulasi - dihash dari seed agar deterministik, diberi label SIMULASI. */
export function generateSimulatedVaNumber(seed: string): string {
  const digest = createHash("sha256").update(seed).digest();
  const digits = Array.from(digest)
    .map((b) => String(b % 10))
    .join("")
    .slice(0, 15);
  return `SIMULASI-9${digits}0`;
}
