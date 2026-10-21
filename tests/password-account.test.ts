import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_ATTEMPTS_PER_CLIENT,
  MAX_FAILURES_PER_LOGIN,
  THROTTLE_WINDOW_MS,
  displayNameSchema,
  loginIdSchema,
  optionalPasswordSchema,
  ownerIdForAccount,
  passwordSchema,
  toSummary,
  type PasswordAccount,
} from "../src/domain/identity/entities/password-account";

test("login ID is trimmed and lowercased, and limited to a safe alphabet", () => {
  assert.equal(loginIdSchema.parse(" Taro.k "), "taro.k");
  for (const bad of ["ab", "a".repeat(33), "taro k", "太郎"])
    assert.equal(loginIdSchema.safeParse(bad).success, false, bad);
  assert.equal(loginIdSchema.safeParse("a".repeat(32)).success, true);
});

test("display name is trimmed and 1 to 50 characters", () => {
  assert.equal(displayNameSchema.parse(" 太郎 "), "太郎");
  assert.equal(displayNameSchema.safeParse("").success, false);
  assert.equal(displayNameSchema.safeParse("あ".repeat(51)).success, false);
  assert.equal(displayNameSchema.safeParse("あ".repeat(50)).success, true);
});

test("password is 12 to 128 characters", () => {
  for (const [length, ok] of [
    [11, false],
    [12, true],
    [128, true],
    [129, false],
  ] as const)
    assert.equal(
      passwordSchema.safeParse("a".repeat(length)).success,
      ok,
      String(length),
    );
});

test("optional password treats blank as not provided", () => {
  assert.equal(optionalPasswordSchema.parse(""), undefined);
  assert.equal(optionalPasswordSchema.parse(" ".repeat(12)), undefined);
  assert.equal(optionalPasswordSchema.parse("a".repeat(12)), "a".repeat(12));
  assert.equal(optionalPasswordSchema.safeParse("short").success, false);
});

test("throttle rule: per client, 20 attempts and 5 per login ID in 15 minutes", () => {
  // services/api/auth uses the same values on the same table.
  assert.equal(MAX_ATTEMPTS_PER_CLIENT, 20);
  assert.equal(MAX_FAILURES_PER_LOGIN, 5);
  assert.equal(THROTTLE_WINDOW_MS, 15 * 60 * 1000);
});

test("conversation owner ID for an account is prefixed", () => {
  assert.equal(ownerIdForAccount("ck1"), "password:ck1");
});

test("summary hides secrets", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const account: PasswordAccount = {
    id: "ck1",
    loginId: "taro",
    displayName: "太郎",
    passwordHash: "secret",
    sessionVersion: 3,
    createdAt: now,
  };
  assert.deepEqual(toSummary(account), {
    id: "ck1",
    loginId: "taro",
    displayName: "太郎",
    createdAt: now,
  });
});
