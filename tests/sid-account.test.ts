// The Sparklingstadt ID display-name rule and the form of a sub.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SID_DISPLAY_NAME_MAX_CODE_POINTS,
  SID_SUB_PATTERN,
  sidDisplayName,
} from "../src/domain/identity/sid-account";

test("the display name limit and the sub form", () => {
  assert.equal(SID_DISPLAY_NAME_MAX_CODE_POINTS, 50);
  for (const sub of ["cabc123", "a", "0".repeat(64)]) {
    assert.ok(SID_SUB_PATTERN.test(sub), sub);
  }
  for (const sub of ["", "A/B", "Cabc", "a".repeat(65), "abc\n", "ab-c"]) {
    assert.ok(!SID_SUB_PATTERN.test(sub), sub);
  }
});

test("the display name is the trimmed name, at most 50 code points", () => {
  assert.equal(sidDisplayName("  ふわ  ", "alice@example.com"), "ふわ");
  assert.equal(sidDisplayName("あ".repeat(51), "a@x"), "あ".repeat(50));
  assert.equal(sidDisplayName("😀".repeat(50) + "x", "a@x"), "😀".repeat(50));
});

test("a blank name falls back to the email before its first @", () => {
  assert.equal(sidDisplayName("", "alice@example.com"), "alice");
  assert.equal(sidDisplayName("　", "bob@x"), "bob");
  assert.equal(sidDisplayName("", "a".repeat(60) + "@x"), "a".repeat(50));
  assert.equal(sidDisplayName("", "a@b@c"), "a");
  assert.equal(sidDisplayName("", "no-at"), "no-at");
});
