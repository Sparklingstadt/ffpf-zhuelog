import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOCK_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
  displayNameSchema,
  isLocked,
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

test("lock rule: 5 failures lock for 15 minutes", () => {
  assert.equal(MAX_FAILED_ATTEMPTS, 5);
  assert.equal(LOCK_DURATION_MS, 15 * 60 * 1000);
});

test("an account is locked only while lockedUntil is in the future", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  assert.equal(
    isLocked({ lockedUntil: new Date(now.getTime() + 1) }, now),
    true,
  );
  assert.equal(isLocked({ lockedUntil: now }, now), false);
  assert.equal(
    isLocked({ lockedUntil: new Date(now.getTime() - 1) }, now),
    false,
  );
  assert.equal(isLocked({ lockedUntil: null }, now), false);
});

test("conversation owner ID for an account is prefixed", () => {
  assert.equal(ownerIdForAccount("ck1"), "password:ck1");
});

test("summary hides secrets and reports the lock state", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const account: PasswordAccount = {
    id: "ck1",
    loginId: "taro",
    displayName: "太郎",
    passwordHash: "secret",
    sessionVersion: 3,
    failedAttempts: 2,
    lockedUntil: new Date(now.getTime() + 1000),
    createdAt: now,
  };
  assert.deepEqual(toSummary(account, now), {
    id: "ck1",
    loginId: "taro",
    displayName: "太郎",
    createdAt: now,
    locked: true,
  });
  assert.equal(toSummary({ ...account, lockedUntil: null }, now).locked, false);
});
