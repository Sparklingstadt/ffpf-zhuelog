import { randomBytes } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const LENGTH = 24;
// The largest multiple of the alphabet size that fits in a byte; bytes at or
// above it are dropped so every letter is equally likely (no modulo bias).
const LIMIT = 256 - (256 % ALPHABET.length);

// An id shaped like the retired Go API's: "c" and 24 of a-z0-9, from crypto random.
export function newId(): string {
  let out = "c";
  while (out.length < LENGTH + 1) {
    for (const byte of randomBytes(LENGTH * 2)) {
      if (byte >= LIMIT) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === LENGTH + 1) break;
    }
  }
  return out;
}
