import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { readLinkCode } from "../src/domain/line/link-code";
import {
  hashLinkCode,
  newLinkCode,
} from "../src/infrastructure/line/link-code-crypto";

test("a new code is one readLinkCode accepts", () => {
  for (let i = 0; i < 50; i++) {
    const code = newLinkCode();
    assert.equal(readLinkCode(code), code);
  }
});

test("the stored hash is SHA-256 in lowercase hex", () => {
  assert.equal(
    hashLinkCode("ABCDEFGH"),
    createHash("sha256").update("ABCDEFGH").digest("hex"),
  );
  assert.match(hashLinkCode("ABCDEFGH"), /^[0-9a-f]{64}$/);
});
