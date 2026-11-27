// The password hash format. The web writes and verifies every hash: admin
// accounts, own password changes, sign-in, the e2e fixtures and the local
// seed. tests/fixtures/scrypt-golden.json pins the format, because the
// hashes already stored must keep verifying.

import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

// The parameters of every hash the web writes.
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
// the stored format. hash() is this with a fresh random salt.
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
// characters).
export function generatePassword() {
  return randomBytes(SCRYPT_PARAMS.generatedBytes).toString("base64url");
}

// The key derivation verify runs; swappable only so tests can make it fail.
export type DeriveKey = (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
) => Promise<Buffer>;

export class ScryptPasswordHasher {
  private dummyHash: Promise<string> | undefined;

  constructor(private readonly derive: DeriveKey = deriveKey) {}

  hash(password: string) {
    return hashWithSalt(password, randomBytes(SALT_BYTES));
  }

  // false for a wrong password, a hash it cannot read, or a failure of the
  // computation itself: a failure must look like a mismatch, or verify and
  // simulate would answer differently and tell whether an account exists.
  async verify(password: string, passwordHash: string) {
    const parsed = parse(passwordHash);
    if (!parsed) return false;
    try {
      const actual = await this.derive(
        password,
        parsed.salt,
        parsed.key.length,
        { ...parsed.params, maxmem: MAX_MEMORY },
      );
      return (
        actual.length === parsed.key.length &&
        timingSafeEqual(actual, parsed.key)
      );
    } catch {
      return false;
    }
  }

  // The dummy hash of a random password that simulate verifies against,
  // created once. A failed creation is forgotten, so the next call tries again.
  private dummy() {
    this.dummyHash ??= this.hash(generatePassword()).catch((error) => {
      this.dummyHash = undefined;
      throw error;
    });
    return this.dummyHash;
  }

  // Builds the dummy hash now, so the first simulate costs one verify like
  // the rest. Never throws; a failure is retried by simulate. Not called at
  // import, so a cold start never pays a scrypt for it.
  async warm() {
    try {
      await this.dummy();
    } catch {
      // simulate builds it again.
    }
  }

  // Spends the work of one verify on a valid hash, for a failure that must
  // cost as much as a wrong password. Never throws. Without a warm(), the
  // dummy hash is built on the first call.
  async simulate(password: string) {
    try {
      await this.verify(password, await this.dummy());
    } catch {
      // A failed dummy hash costs less, but simulate must never throw.
    }
  }
}
