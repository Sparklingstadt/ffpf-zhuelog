import { createHmac, timingSafeEqual } from "node:crypto";

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

export async function readLimitedBody(request: Request, maxBytes = 64 * 1024) {
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new Error("BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
