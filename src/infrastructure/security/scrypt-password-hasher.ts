// The password hash format Go verifies at sign-in
// (services/api/auth/password.go). The web writes every hash: admin accounts,
// own password changes, the e2e fixtures and the local seed.

import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

// The parameters Go writes and the web writes (services/api/auth/password.go).
export const SCRYPT_PARAMS = {
  n: 32768,
  r: 8,
  p: 1,
  saltBytes: 16,
  keyBytes: 64,
  generatedBytes: 15,
} as const;

const N = SCRYPT_PARAMS.n;
const R = SCRYPT_PARAMS.r;
const P = SCRYPT_PARAMS.p;
const SALT_BYTES = SCRYPT_PARAMS.saltBytes;
const KEY_BYTES = SCRYPT_PARAMS.keyBytes;
const MAX_MEMORY = 64 * 1024 * 1024;

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

// Pure apart from the computation: the hash of password with this salt, in
// Go's format. hash() is this with a fresh random salt.
export async function hashWithSalt(password: string, salt: Buffer) {
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

// A password to hand out: 15 random bytes as unpadded base64url (20
// characters). Go: GeneratePassword.
export function generatePassword() {
  return randomBytes(SCRYPT_PARAMS.generatedBytes).toString("base64url");
}

export class ScryptPasswordHasher {
  private dummyHash: Promise<string> | undefined;

  hash(password: string) {
    return hashWithSalt(password, randomBytes(SALT_BYTES));
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

  // Spends the work of one verify on a valid hash, for a failure that must
  // cost as much as a wrong password. Never throws. Go: Simulate. The dummy
  // hash of a random password is built once, on the first call (Go: Warm).
  async simulate(password: string) {
    try {
      this.dummyHash ??= this.hash(generatePassword());
      await this.verify(password, await this.dummyHash);
    } catch {
      // A failed dummy hash costs less, but simulate must never throw.
    }
  }
}
