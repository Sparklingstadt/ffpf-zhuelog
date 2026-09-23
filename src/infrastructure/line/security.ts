import { createHmac, timingSafeEqual } from "node:crypto";
export { readLimitedBody } from "../http/read-limited-body";

export function verifyLineSignature(
  body: Buffer,
  signature: string | null,
  secret: string,
) {
  if (!signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(signature, "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifyWorkerToken(header: string | null, secret: string) {
  const actual = Buffer.from(header || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
