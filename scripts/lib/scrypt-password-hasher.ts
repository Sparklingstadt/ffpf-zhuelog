import { randomBytes, scrypt, type ScryptOptions } from "node:crypto";

const N = 2 ** 15;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
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

// The hash format the Go API verifies (services/api/auth/password.go). Only
// the e2e fixtures and the local seed script write hashes from Node.
export class ScryptPasswordHasher {
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
}
