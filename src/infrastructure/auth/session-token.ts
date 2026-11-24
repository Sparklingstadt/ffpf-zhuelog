// The session cookie's token: 32 bytes from the CSPRNG, base64url without
// padding. The database keeps only its SHA-256, so a leaked table cannot be
// replayed as cookies.
import { createHash, randomBytes } from "node:crypto";

export const SESSION_TOKEN_BYTES = 32;

// 32 bytes are 43 base64url characters without padding.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function newSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

// Lets a malformed cookie be refused without a query.
export function isSessionTokenShape(value: string): boolean {
  return TOKEN_SHAPE.test(value);
}

// SHA-256 in lowercase hex: what a Session row stores in place of the token.
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
