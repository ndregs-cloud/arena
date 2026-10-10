#!/usr/bin/env node
/** Cetak kode TOTP 6 angka untuk secret dev seed (memakai implementasi domain, tanpa menyimpan apa pun). */
import { createHmac, randomBytes } from "node:crypto";

const secret = process.argv[2] ?? "JBSWY3DPEHPK3PXP";
const step = 30;
const counter = Math.floor(Date.now() / 1000 / step);

function base32Decode(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return Buffer.from(bytes);
}

export function totp(secretValue = secret, counterValue = counter) {
  const key = base32Decode(secretValue);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counterValue));
  const digest = createHmac("sha1", key).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
  return code;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`Kode TOTP saat ini (secret ${secret}): ${totp()}`);
  console.log(`Berlaku ${step - (Math.floor(Date.now() / 1000) % step)} detik lagi.`);
}
