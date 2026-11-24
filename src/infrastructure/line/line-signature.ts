import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Whether signature is the HMAC-SHA256 of body under the channel secret.
// signature is the X-Line-Signature header; body must be the raw request
// bytes, never text decoded and encoded again. An empty secret or signature
// never verifies.
//
// Node's Base64 decoder skips characters it does not know, so the header is
// not decoded: it is compared with the canonical Base64 of the MAC (the only
// form LINE sends), both hashed first so the comparison takes the same time
// whatever the header's length.
export function verifyLineSignature(
  secret: string,
  body: Uint8Array,
  signature: string | null,
): boolean {
  if (secret === "" || !signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("base64");
  return timingSafeEqual(sha256(expected), sha256(signature));
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
