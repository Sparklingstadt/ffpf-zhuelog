import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaClient } from "../src/generated/prisma/client";
import {
  createPasswordAccountSql,
  createPasswordAccountStore,
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

function fakeTransactionDb(rows: { loginId: string }[]) {
  const statements: { text: string; values: unknown[] }[] = [];
  const deletes: unknown[] = [];
  const options: unknown[] = [];
  const tx = {
    $queryRaw: async (sql: { text: string; values: unknown[] }) => {
      statements.push(sql);
      return rows;
    },
    session: {
      deleteMany: async (args: unknown) => {
        deletes.push(args);
        return { count: 2 };
      },
    },
  };
  const db = {
    $transaction: async (
      run: (t: typeof tx) => Promise<unknown>,
      opts: unknown,
    ) => {
      options.push(opts);
      return run(tx);
    },
  } as unknown as PrismaClient;
  return { db, statements, deletes, options };
}

test("a reset deletes the owner's sessions in the same transaction", async () => {
  const { db, statements, deletes, options } = fakeTransactionDb([
    { loginId: "taro" },
  ]);
  const store = createPasswordAccountStore(() => db);
  assert.equal(await store.setPassword("cx", "scrypt:new", now), "taro");
  assert.equal(statements.length, 1);
  assert.equal(
    statements[0].text,
    setPasswordSql("cx", "scrypt:new", now).text,
  );
  assert.deepEqual(statements[0].values, ["scrypt:new", now, "cx"]);
  assert.deepEqual(deletes, [{ where: { ownerId: "password:cx" } }]);
  assert.deepEqual(options, [{ maxWait: 5000, timeout: 10000 }]);
});

test("a reset of a missing account deletes nothing", async () => {
  const { db, deletes, options } = fakeTransactionDb([]);
  const store = createPasswordAccountStore(() => db);
  assert.equal(await store.setPassword("cx", "scrypt:new", now), null);
  assert.deepEqual(deletes, []);
  assert.equal(options.length, 1);
});

test("a password change deletes the owner's sessions in the same transaction", async () => {
  const { db, statements, deletes, options } = fakeTransactionDb([
    { loginId: "taro" },
  ]);
  const store = createPasswordAccountStore(() => db);
  assert.equal(
    await store.replacePassword("cx", "scrypt:old", "scrypt:new", now),
    true,
  );
  assert.deepEqual(statements[0].values, [
    "scrypt:new",
    now,
    "cx",
    "scrypt:old",
  ]);
  assert.deepEqual(deletes, [{ where: { ownerId: "password:cx" } }]);
  assert.deepEqual(options, [{ maxWait: 5000, timeout: 10000 }]);
});

test("a replaced-meanwhile change deletes nothing", async () => {
  const { db, deletes } = fakeTransactionDb([]);
  const store = createPasswordAccountStore(() => db);
  assert.equal(
    await store.replacePassword("cx", "scrypt:old", "scrypt:new", now),
    false,
  );
  assert.deepEqual(deletes, []);
});

test("sign-in looks an account up by loginId, reading only what it needs", async () => {
  const queries: unknown[] = [];
  const row = { id: "cacc1", passwordHash: "scrypt:x", sessionVersion: 3 };
  const db = {
    passwordAccount: {
      findUnique: async (args: unknown) => {
        queries.push(args);
        return row;
      },
    },
  } as unknown as PrismaClient;
  const store = createPasswordAccountStore(() => db);
  assert.deepEqual(await store.findByLoginId("alice"), row);
  assert.deepEqual(queries, [
    {
      where: { loginId: "alice" },
      select: { id: true, passwordHash: true, sessionVersion: true },
    },
  ]);
});
