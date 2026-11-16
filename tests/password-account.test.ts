import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkNewAccount,
  choosePassword,
  firstCodePoints,
  isAccountIdShape,
  isPlausibleCurrentPassword,
  isValidNewPassword,
  normalizeDisplayName,
  normalizeLoginId,
} from "../src/domain/identity/password-account";

// Mirrors services/api/auth/validate_test.go and TestAdminCreateAccount*.
test("login ids, names and passwords follow Go's rules", () => {
  const loginIds: [string, string][] = [
    ["alice", "alice"],
    ["  Alice.W_9-x ", "alice.w_9-x"],
    ["﻿alice　", "alice"],
    // U+212A KELVIN SIGN lowercases to "k".
    ["Kabc", "kabc"],
    ["a.-", "a.-"],
    ["z".repeat(32), "z".repeat(32)],
  ];
  for (const [raw, want] of loginIds) {
    assert.equal(normalizeLoginId(raw), want, JSON.stringify(raw));
  }
  for (const raw of [
    // U+0085 is not JS whitespace, so trim() keeps it.
    "\u0085alice",
    // U+0130 lowercases to "i" + U+0307.
    "İabc",
    "ab",
    "z".repeat(33),
    "al ice",
    "",
    "あいう",
  ]) {
    assert.equal(normalizeLoginId(raw), null, JSON.stringify(raw));
  }

  assert.equal(normalizeDisplayName("  Alice  "), "Alice");
  assert.equal(normalizeDisplayName("あ".repeat(50)), "あ".repeat(50));
  assert.equal(normalizeDisplayName("😀".repeat(25)), "😀".repeat(25));
  for (const raw of ["あ".repeat(51), "😀".repeat(26), " \t　", "a\u0000b"]) {
    assert.equal(normalizeDisplayName(raw), null, JSON.stringify(raw));
  }

  for (const password of [
    "123456789012",
    "a".repeat(128),
    "あ".repeat(12),
    "😀".repeat(6),
    "😀".repeat(64),
    "   spaces   ",
  ]) {
    assert.equal(isValidNewPassword(password), true, password);
  }
  for (const password of [
    "12345678901",
    "a".repeat(129),
    "あ".repeat(11),
    "😀".repeat(65),
    "",
    " eleven run",
  ]) {
    assert.equal(isValidNewPassword(password), false, password);
  }

  assert.deepEqual(choosePassword(""), { generate: true });
  assert.deepEqual(choosePassword("   \t "), { generate: true });
  assert.deepEqual(choosePassword("  keep spaces 1 "), {
    generate: false,
    password: "  keep spaces 1 ",
  });
  assert.equal(choosePassword("short"), null);
});

test("checkNewAccount checks loginId, then name, then password", () => {
  const cases: [
    { loginId: string; displayName: string; password: string },
    string,
  ][] = [
    [{ loginId: "ab", displayName: "x", password: "" }, "login-id"],
    [{ loginId: "!", displayName: "", password: "x" }, "login-id"],
    [{ loginId: "abc", displayName: "   ", password: "" }, "display-name"],
    [{ loginId: "abc", displayName: "", password: "x" }, "display-name"],
    [{ loginId: "abc", displayName: "x", password: "12345678901" }, "password"],
  ];
  for (const [input, error] of cases) {
    assert.deepEqual(
      checkNewAccount(input),
      { ok: false, error },
      JSON.stringify(input),
    );
  }
  assert.deepEqual(
    checkNewAccount({
      loginId: "  Alice.W ",
      displayName: "  Alice  ",
      password: "",
    }),
    {
      ok: true,
      loginId: "alice.w",
      displayName: "Alice",
      password: { generate: true },
    },
  );
});

test("account ids and current passwords are checked like Go", () => {
  assert.equal(isAccountIdShape("cx"), true);
  assert.equal(isAccountIdShape("a".repeat(128)), true);
  assert.equal(isAccountIdShape(""), false);
  assert.equal(isAccountIdShape("a".repeat(129)), false);
  // 43 × 3 bytes = 129 UTF-8 bytes.
  assert.equal(isAccountIdShape("あ".repeat(43)), false);
  assert.equal(isAccountIdShape("a\u0000b"), false);

  assert.equal(isPlausibleCurrentPassword("x"), true);
  assert.equal(isPlausibleCurrentPassword("パ".repeat(128)), true);
  assert.equal(isPlausibleCurrentPassword(""), false);
  assert.equal(isPlausibleCurrentPassword("x".repeat(129)), false);
  assert.equal(isPlausibleCurrentPassword("パ".repeat(129)), false);

  assert.equal(firstCodePoints("😀".repeat(130), 128), "😀".repeat(128));
});
