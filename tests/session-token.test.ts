import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hashSessionToken,
  isSessionTokenShape,
  newSessionToken,
} from "../src/infrastructure/auth/session-token";

test("a session token is 32 random bytes as base64url", () => {
  const tokens = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const token = newSessionToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(token, "base64url").length, 32);
    tokens.add(token);
  }
  assert.equal(tokens.size, 1000);
});

test("the hash is SHA-256 in lowercase hex", () => {
  assert.equal(
    hashSessionToken("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("only 43 base64url characters look like a token", () => {
  assert.equal(isSessionTokenShape("A".repeat(43)), true);
  for (const value of [
    "A".repeat(42),
    "A".repeat(44),
    "A".repeat(42) + "=",
    "A".repeat(42) + "+",
    "",
  ]) {
    assert.equal(isSessionTokenShape(value), false, value);
  }
});
