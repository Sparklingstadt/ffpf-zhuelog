import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaClient } from "../src/generated/prisma/client";
import { PASSWORD_CHANGE_THROTTLE } from "../src/domain/identity/sign-in-throttle";
import {
  consumeThrottleSql,
  createSignInThrottleStore,
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

function fakeDb(count: number | bigint) {
  const statements: { kind: string; values: unknown[] }[] = [];
  const db = {
    $executeRaw: async (sql: { values: unknown[] }) => {
      statements.push({ kind: "execute", values: sql.values });
      return 0;
    },
    $queryRaw: async (sql: { values: unknown[] }) => {
      statements.push({ kind: "query", values: sql.values });
      return [{ count }];
    },
  };
  return { db: db as unknown as PrismaClient, statements };
}

test("consume allows the rule's limit and refuses the attempt after it", async () => {
  const key = "password-change:cacc1";
  for (const [count, allowed] of [
    [5, true],
    [6, false],
    [BigInt(5), true],
    [BigInt(6), false],
  ] as const) {
    const { db, statements } = fakeDb(count);
    const store = createSignInThrottleStore(() => db);
    assert.equal(
      await store.consume(key, PASSWORD_CHANGE_THROTTLE, now),
      allowed,
      String(count),
    );
    const expiresAt = new Date(
      now.getTime() + PASSWORD_CHANGE_THROTTLE.windowMs,
    );
    assert.deepEqual(statements, [
      { kind: "execute", values: [now, 100] },
      { kind: "query", values: [key, expiresAt, now, now, expiresAt] },
    ]);
  }
});
