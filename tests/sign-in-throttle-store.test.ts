import assert from "node:assert/strict";
import { test } from "node:test";

import {
  consumeThrottleSql,
  pruneThrottleSql,
} from "../src/infrastructure/prisma/sign-in-throttle-store";

const now = new Date("2026-11-17T03:00:00.000Z");

test("pruneThrottleSql deletes at most 100 dead rows without waiting", () => {
  const sql = pruneThrottleSql(now);
  const text = sql.text.replace(/\s+/g, " ");
  assert.ok(text.includes('"expiresAt" <= CAST($1 AS TIMESTAMP(3))'), text);
  assert.ok(text.includes("LIMIT $2 FOR UPDATE SKIP LOCKED"), text);
  assert.deepEqual(sql.values, [now, 100]);
});

test("consumeThrottleSql counts in one statement as Go did", () => {
  const expiresAt = new Date("2026-11-17T03:15:00.000Z");
  const sql = consumeThrottleSql("password-change:cacc1", now, expiresAt);
  const text = sql.text.replace(/\s+/g, " ");
  for (const part of [
    'ON CONFLICT ("key") DO UPDATE SET',
    'THEN 1 ELSE "SignInThrottle"."count" + 1 END',
    'RETURNING "count"',
  ]) {
    assert.ok(text.includes(part), text);
  }
  assert.deepEqual(sql.values, [
    "password-change:cacc1",
    expiresAt,
    now,
    now,
    expiresAt,
  ]);
});
