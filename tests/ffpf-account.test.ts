// Mirrors services/api/auth/login_test.go (TestLoginFFPFDisplayName) and the
// name rule of services/api/auth/ffpf.go's verify.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FFPF_DISPLAY_NAME_MAX_CODE_POINTS,
  FFPF_SUB_PATTERN,
  ffpfDisplayName,
} from "../src/domain/identity/ffpf-account";

test("Go's numbers and sub form", () => {
  assert.equal(FFPF_DISPLAY_NAME_MAX_CODE_POINTS, 50);
  for (const sub of ["cabc123", "a", "0".repeat(64)]) {
    assert.ok(FFPF_SUB_PATTERN.test(sub), sub);
  }
  for (const sub of ["", "A/B", "Cabc", "a".repeat(65), "abc\n", "ab-c"]) {
    assert.ok(!FFPF_SUB_PATTERN.test(sub), sub);
  }
});

test("the display name is the trimmed name, at most 50 code points", () => {
  assert.equal(ffpfDisplayName("  ふわ  ", "alice@example.com"), "ふわ");
  assert.equal(ffpfDisplayName("あ".repeat(51), "a@x"), "あ".repeat(50));
  assert.equal(ffpfDisplayName("😀".repeat(50) + "x", "a@x"), "😀".repeat(50));
});

test("a blank name falls back to the email before its first @", () => {
  assert.equal(ffpfDisplayName("", "alice@example.com"), "alice");
  assert.equal(ffpfDisplayName("　", "bob@x"), "bob");
  assert.equal(ffpfDisplayName("", "a".repeat(60) + "@x"), "a".repeat(50));
  assert.equal(ffpfDisplayName("", "a@b@c"), "a");
  assert.equal(ffpfDisplayName("", "no-at"), "no-at");
});
