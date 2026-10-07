import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

import type { PasswordHasher } from "@ffpf-zhuelog/core/application/identity/ports/password-hasher";

const N = 2 ** 15;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MAX_MEMORY = 64 * 1024 * 1024;
const GENERATED_PASSWORD_BYTES = 15;

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

function isPowerOfTwo(value: number) {
  return Number.isInteger(value) && value >= 2 && (value & (value - 1)) === 0;
}

// Returns null for anything that is not a hash this implementation could have
// written, or whose parameters would cost more than the ones it writes.
function parse(passwordHash: string) {
  const parts = passwordHash.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, n, r, p, encodedSalt, encodedKey] = parts;
  if (![n, r, p].every((value) => /^\d{1,9}$/.test(value))) return null;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (!isPowerOfTwo(params.N) || params.N > N) return null;
  if (params.r < 1 || params.r > R || params.p < 1 || params.p > 4) return null;
  const salt = Buffer.from(encodedSalt, "base64url");
  const key = Buffer.from(encodedKey, "base64url");
  if (salt.length === 0 || salt.toString("base64url") !== encodedSalt)
    return null;
  if (key.length !== KEY_BYTES || key.toString("base64url") !== encodedKey)
    return null;
  return { params, salt, key };
}

export class ScryptPasswordHasher implements PasswordHasher {
  // Created on first use so importing this module costs nothing.
  private dummyHash: Promise<string> | undefined;

  async hash(password: string) {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey(password, salt, KEY_BYTES, {
      N,
      r: R,
      p: P,
      maxmem: MAX_MEMORY,
    });
    return [
      "scrypt",
      N,
      R,
      P,
      salt.toString("base64url"),
      key.toString("base64url"),
    ].join(":");
  }

  async verify(password: string, passwordHash: string) {
    const parsed = parse(passwordHash);
    if (!parsed) return false;
    try {
      const actual = await deriveKey(password, parsed.salt, parsed.key.length, {
        ...parsed.params,
        maxmem: MAX_MEMORY,
      });
      return (
        actual.length === parsed.key.length &&
        timingSafeEqual(actual, parsed.key)
      );
    } catch {
      return false;
    }
  }

  async simulateVerify(password: string) {
    const pending = (this.dummyHash ??= this.hash(
      randomBytes(GENERATED_PASSWORD_BYTES).toString("base64url"),
    ));
    let dummyHash: string;
    try {
      dummyHash = await pending;
    } catch (error) {
      // Do not keep a rejected promise: the next call builds a fresh one.
      if (this.dummyHash === pending) this.dummyHash = undefined;
      throw error;
    }
    await this.verify(password, dummyHash);
  }

  generate() {
    return randomBytes(GENERATED_PASSWORD_BYTES).toString("base64url");
  }
}
