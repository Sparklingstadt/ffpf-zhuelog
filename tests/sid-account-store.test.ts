import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaClient } from "../src/generated/prisma/client";
import {
  createSidAccountStore,
  upsertSidAccountSql,
} from "../src/infrastructure/prisma/sid-account-store";

const now = new Date("2026-11-17T03:00:00.000Z");
const input = {
  id: "cabc123",
  email: "alice@example.com",
  displayName: "ふわ",
};

test("upsertSidAccountSql keeps sessionVersion and createdAt on a second sign-in", () => {
  const sql = upsertSidAccountSql(input, now);
  const text = sql.text.replace(/\s+/g, " ");
  for (const part of [
    'INSERT INTO "SidAccount" ("id", "email", "displayName", "sessionVersion", "createdAt", "updatedAt", "lastLoginAt")',
    "VALUES ($1, $2, $3, 0, CAST($4 AS TIMESTAMP(3)), CAST($5 AS TIMESTAMP(3)), CAST($6 AS TIMESTAMP(3)))",
    'ON CONFLICT ("id") DO UPDATE SET',
    '"email" = EXCLUDED."email"',
    '"displayName" = EXCLUDED."displayName"',
    '"lastLoginAt" = EXCLUDED."lastLoginAt"',
    '"updatedAt" = EXCLUDED."updatedAt"',
    'RETURNING "sessionVersion"',
  ]) {
    assert.ok(text.includes(part), text);
  }
  const set = text.slice(text.indexOf("DO UPDATE SET"));
  assert.ok(!set.includes('"sessionVersion" ='), set);
  assert.ok(!set.includes('"createdAt" ='), set);
  assert.deepEqual(sql.values, [
    "cabc123",
    "alice@example.com",
    "ふわ",
    now,
    now,
    now,
  ]);
});

test("upsert answers the stored sessionVersion", async () => {
  const statements: { text: string; values: unknown[] }[] = [];
  const db = {
    $queryRaw: async (sql: { text: string; values: unknown[] }) => {
      statements.push(sql);
      return [{ sessionVersion: 4 }];
    },
  } as unknown as PrismaClient;
  const store = createSidAccountStore(() => db);
  assert.deepEqual(await store.upsert(input, now), { sessionVersion: 4 });
  assert.equal(statements.length, 1);
  assert.deepEqual(
    statements[0]!.values,
    upsertSidAccountSql(input, now).values,
  );
});

test("upsert without a returned row throws", async () => {
  const db = { $queryRaw: async () => [] } as unknown as PrismaClient;
  await assert.rejects(createSidAccountStore(() => db).upsert(input, now));
});
