import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { verifyLineSignature } from "../src/infrastructure/line/line-signature";

const bytes = (s: string) => new TextEncoder().encode(s);
const sign = (secret: string, body: Uint8Array) =>
  createHmac("sha256", secret).update(body).digest("base64");

test("the signature is HMAC-SHA256 over the raw bytes", () => {
  const secret = "channel-secret";
  const body = bytes('{"events":[]}');
  const signature = sign(secret, body);

  assert.equal(verifyLineSignature(secret, body, signature), true);

  assert.equal(
    verifyLineSignature(secret, bytes('{"events":[ ]}'), signature),
    false,
  );
  assert.equal(verifyLineSignature("other", body, signature), false);
  assert.equal(verifyLineSignature(secret, body, null), false);
  assert.equal(verifyLineSignature(secret, body, ""), false);
  assert.equal(verifyLineSignature(secret, body, "!!!not-base64!!!"), false);
  assert.equal(
    verifyLineSignature(secret, body, signature.slice(0, -4)),
    false,
  );
  assert.equal(verifyLineSignature("", body, sign("", body)), false);
  // Node's Base64 decoder skips stray characters; the check must not.
  assert.equal(verifyLineSignature(secret, body, `${signature}!`), false);
});

test("bytes that are not UTF-8 are signed as they are", () => {
  const secret = "channel-secret";
  const body = new Uint8Array([
    ...bytes('{"events":["'),
    0xff,
    ...bytes('"]}'),
  ]);
  assert.equal(verifyLineSignature(secret, body, sign(secret, body)), true);
  // Decoding to text and back would turn 0xff into U+FFFD.
  const reencoded = bytes(new TextDecoder().decode(body));
  assert.equal(
    verifyLineSignature(secret, body, sign(secret, reencoded)),
    false,
  );
});
