import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createPasswordAccountSql,
  setPasswordSql,
} from "../src/infrastructure/prisma/password-account-store";

const now = new Date("2026-11-17T03:00:00.000Z");

test("createPasswordAccountSql treats a taken loginId as no row", () => {
  const sql = createPasswordAccountSql(
    "cid",
    { loginId: "alice", displayName: "Alice", passwordHash: "scrypt:x" },
    now,
  );
  const text = sql.text.replace(/\s+/g, " ");
  for (const part of [
    'INSERT INTO "PasswordAccount"',
    "0, CAST($5 AS TIMESTAMP(3)), CAST($6 AS TIMESTAMP(3))",
    'ON CONFLICT ("loginId") DO NOTHING',
    'RETURNING "id", "loginId", "displayName", "createdAt"',
  ]) {
    assert.ok(text.includes(part), text);
  }
  assert.deepEqual(sql.values, ["cid", "alice", "Alice", "scrypt:x", now, now]);
});

test("setPasswordSql bumps the session in the same statement", () => {
  const sql = setPasswordSql("cx", "scrypt:new", now);
  const text = sql.text.replace(/\s+/g, " ");
  for (const part of [
    '"passwordHash" = $1',
    '"sessionVersion" = "sessionVersion" + 1',
    '"updatedAt" = CAST($2 AS TIMESTAMP(3))',
    'WHERE "id" = $3',
    'RETURNING "loginId"',
  ]) {
    assert.ok(text.includes(part), text);
  }
  assert.ok(!text.includes('AND "passwordHash"'), text);
  assert.deepEqual(sql.values, ["scrypt:new", now, "cx"]);

  const guarded = setPasswordSql("cx", "scrypt:new", now, "scrypt:old");
  const guardedText = guarded.text.replace(/\s+/g, " ");
  assert.ok(guardedText.includes('AND "passwordHash" = $4'), guardedText);
  assert.equal(guarded.values.at(-1), "scrypt:old");
});
