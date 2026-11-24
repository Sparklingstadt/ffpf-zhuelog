import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LINK_CODE_TTL_MS,
  LINK_REDEEM_THROTTLE,
  lineLinkThrottleKey,
  linkCodeFromBytes,
  readLinkCode,
} from "../src/domain/line/link-code";

test("link codes are normalised before they are read and hashed", () => {
  for (const text of [
    "ABCD2345",
    " abcd2345 ",
    "ＡＢＣＤ２３４５",
    "　ａｂｃｄ２３４５　",
    "ABCD2345\u0085",
  ])
    assert.equal(readLinkCode(text), "ABCD2345", JSON.stringify(text));
  for (const text of [
    "ABCD234",
    "ABCD23456",
    "ABCD2340",
    "ABCD2341",
    "ABCDO345",
    "ABCDI345",
    "ABCD 345",
    "你好你好你好你好",
    "",
    "ABCD2345\uFEFF",
    "abcd23ß",
  ])
    assert.equal(readLinkCode(text), null, JSON.stringify(text));
});

test("a code is one alphabet letter per byte", () => {
  assert.equal(
    linkCodeFromBytes(Uint8Array.from([0, 31, 32, 255, 8, 23, 24, 63])),
    "A9A9JZ29",
  );
  assert.throws(() => linkCodeFromBytes(new Uint8Array(7)), RangeError);
  assert.throws(() => linkCodeFromBytes(new Uint8Array(9)), RangeError);
});

test("the redeem throttle is 5 an hour per LINE account", () => {
  assert.deepEqual(LINK_REDEEM_THROTTLE, { limit: 5, windowMs: 3600000 });
  assert.equal(lineLinkThrottleKey("U1"), "line-link:U1");
  assert.equal(LINK_CODE_TTL_MS, 600000);
});
