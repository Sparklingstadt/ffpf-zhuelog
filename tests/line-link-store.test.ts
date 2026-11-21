import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaClient } from "../src/generated/prisma/client";
import {
  LINE_TRANSACTION_OPTIONS,
  claimReviewNotifySql,
  createLineLinkStore,
  putLinkCodeSql,
  reviewNotifyTargetsSql,
} from "../src/infrastructure/prisma/line-link-store";

const now = new Date("2026-11-17T21:00:00.000Z");
const japanDay = "2026-11-18";

const flat = (text: string) => text.replace(/\s+/g, " ");

test("putLinkCodeSql replaces the owner's code as Go did", () => {
  const expiresAt = new Date("2026-11-17T21:10:00.000Z");
  const sql = putLinkCodeSql("password:c1", "member", "h", expiresAt);
  const text = flat(sql.text);
  for (const part of [
    'INSERT INTO "LineLinkCode"',
    "CAST($4 AS TIMESTAMP(3))",
    'ON CONFLICT ("ownerId") DO UPDATE SET "codeHash" = EXCLUDED."codeHash", "role" = EXCLUDED."role", "expiresAt" = EXCLUDED."expiresAt"',
  ]) {
    assert.ok(text.includes(part), text);
  }
  assert.deepEqual(sql.values, ["h", "password:c1", "member", expiresAt]);
});

test("reviewNotifyTargetsSql counts due items but not trashed notes", () => {
  const sql = reviewNotifyTargetsSql(now, japanDay, 100);
  const text = flat(sql.text);
  for (const part of [
    "CROSS JOIN LATERAL",
    '"ReviewItem"."due" <= CAST($1 AS TIMESTAMP(3))',
    `"ReviewItem"."kind" = 'entry'`,
    'e."deletedAt" IS NOT NULL',
    '"reviewNotifiedOn" < CAST($2 AS DATE)',
    'd."due" > 0',
    'ORDER BY l."createdAt", l."lineUserId"',
    "LIMIT $3",
  ]) {
    assert.ok(text.includes(part), text);
  }
  assert.deepEqual(sql.values, [now, japanDay, 100]);
});

test("claimReviewNotifySql claims the JST day once", () => {
  const sql = claimReviewNotifySql("U1", japanDay);
  const text = flat(sql.text);
  for (const part of [
    'SET "reviewNotifiedOn" = CAST($1 AS DATE)',
    'AND "reviewNotify"',
    '"reviewNotifiedOn" < CAST($3 AS DATE)',
  ]) {
    assert.ok(text.includes(part), text);
  }
  assert.deepEqual(sql.values, [japanDay, "U1", japanDay]);
});

test("memberExists reads only member prefixes", async () => {
  const calls: { table: string; args: unknown }[] = [];
  const counter = (table: string, n: number) => ({
    count: async (args: unknown) => {
      calls.push({ table, args });
      return n;
    },
  });
  const db = {
    passwordAccount: counter("password", 1),
    sidAccount: counter("sid", 0),
  } as unknown as PrismaClient;
  const store = createLineLinkStore(() => db);

  assert.equal(await store.memberExists("password:c1"), true);
  assert.equal(await store.memberExists("sid:s1"), false);
  assert.deepEqual(calls, [
    { table: "password", args: { where: { id: "c1" } } },
    { table: "sid", args: { where: { id: "s1" } } },
  ]);
  assert.equal(await store.memberExists("10001"), false);
  assert.equal(await store.memberExists("guest"), false);
  assert.equal(calls.length, 2);
});

function fakeRedeemDb(
  codeRows: { ownerId: string; role: string }[],
  linkRows: { lineUserId: string }[],
) {
  const statements: { text: string; values: unknown[] }[] = [];
  const creates: unknown[] = [];
  const options: unknown[] = [];
  const results = [codeRows, linkRows];
  const tx = {
    $queryRaw: async (sql: { text: string; values: unknown[] }) => {
      statements.push({ text: flat(sql.text), values: sql.values });
      return results[statements.length - 1];
    },
    lineLink: {
      create: async (args: unknown) => {
        creates.push(args);
        return {};
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
  return { db, statements, creates, options };
}

test("redeemCode moves both links in one transaction", async () => {
  {
    const { db, statements, creates, options } = fakeRedeemDb([], []);
    const store = createLineLinkStore(() => db);
    assert.equal(await store.redeemCode("h", "U1", now), null);
    assert.equal(statements.length, 1);
    assert.ok(
      statements[0].text.includes(
        'DELETE FROM "LineLinkCode" WHERE "codeHash" = $1 AND "expiresAt" > CAST($2 AS TIMESTAMP(3)) RETURNING "ownerId", "role"',
      ),
      statements[0].text,
    );
    assert.deepEqual(statements[0].values, ["h", now]);
    assert.deepEqual(creates, []);
    assert.deepEqual(options, [{ maxWait: 5000, timeout: 15000 }]);
  }

  for (const [linkRows, relinked] of [
    [[{ lineUserId: "U1" }], true],
    [[{ lineUserId: "U9" }], false],
    [[], false],
  ] as const) {
    const { db, statements, creates, options } = fakeRedeemDb(
      [{ ownerId: "password:c1", role: "member" }],
      [...linkRows],
    );
    const store = createLineLinkStore(() => db);
    assert.deepEqual(await store.redeemCode("h", "U1", now), {
      ownerId: "password:c1",
      role: "member",
      relinked,
    });
    assert.equal(statements.length, 2);
    assert.ok(
      statements[1].text.includes(
        'DELETE FROM "LineLink" WHERE "ownerId" = $1 OR "lineUserId" = $2 RETURNING "lineUserId"',
      ),
      statements[1].text,
    );
    assert.deepEqual(statements[1].values, ["password:c1", "U1"]);
    assert.deepEqual(creates, [
      {
        data: {
          lineUserId: "U1",
          ownerId: "password:c1",
          role: "member",
          createdAt: now,
        },
      },
    ]);
    assert.deepEqual(options, [LINE_TRANSACTION_OPTIONS]);
    assert.deepEqual(LINE_TRANSACTION_OPTIONS, {
      maxWait: 5000,
      timeout: 15000,
    });
  }
});

// Records each lineLink call as [method, args] and answers with `count` (or
// the raw rows for $queryRaw).
function fakeLinkDb(count: number, rows: unknown[] = []) {
  const calls: [string, unknown][] = [];
  const record =
    (method: string, result: () => unknown) => async (args: unknown) => {
      calls.push([method, args]);
      return result();
    };
  const db = {
    lineLink: {
      updateMany: record("updateMany", () => ({ count })),
      deleteMany: record("deleteMany", () => ({ count })),
    },
    $executeRaw: record("$executeRaw", () => count),
    $queryRaw: record("$queryRaw", () => rows),
  } as unknown as PrismaClient;
  return { db, calls };
}

test("setReviewNotify writes only the owner's link and reports whether one was there", async () => {
  for (const [count, linked] of [
    [1, true],
    [0, false],
  ] as const) {
    const { db, calls } = fakeLinkDb(count);
    assert.equal(
      await createLineLinkStore(() => db).setReviewNotify("password:c1", true),
      linked,
    );
    assert.deepEqual(calls, [
      [
        "updateMany",
        { where: { ownerId: "password:c1" }, data: { reviewNotify: true } },
      ],
    ]);
  }
});

test("unlinkOwner and unlinkLineUser each delete by exactly one key", async () => {
  const { db, calls } = fakeLinkDb(1);
  const store = createLineLinkStore(() => db);
  await store.unlinkOwner("password:c1");
  await store.unlinkLineUser("U1");
  assert.deepEqual(calls, [
    ["deleteMany", { where: { ownerId: "password:c1" } }],
    ["deleteMany", { where: { lineUserId: "U1" } }],
  ]);
  // Never an empty where, which would delete every link.
  for (const [, args] of calls) {
    const where = (args as { where: Record<string, unknown> }).where;
    assert.equal(Object.keys(where).length, 1);
  }
});

test("claimReviewNotify claims the JST day and is true only for one row", async () => {
  for (const [count, claimed] of [
    [1, true],
    [0, false],
    [2, false],
  ] as const) {
    const { db, calls } = fakeLinkDb(count);
    assert.equal(
      await createLineLinkStore(() => db).claimReviewNotify("U1", now),
      claimed,
    );
    const sql = calls[0][1] as { values: unknown[] };
    assert.equal(calls[0][0], "$executeRaw");
    assert.deepEqual(sql.values, [japanDay, "U1", japanDay]);
  }
});

test("reviewNotifyTargets passes the JST date and reads due as a number", async () => {
  const { db, calls } = fakeLinkDb(0, [
    {
      lineUserId: "U1",
      ownerId: "password:c1",
      role: "member",
      due: BigInt(3),
    },
  ]);
  assert.deepEqual(
    await createLineLinkStore(() => db).reviewNotifyTargets(now, 100),
    [{ lineUserId: "U1", ownerId: "password:c1", role: "member", due: 3 }],
  );
  const sql = calls[0][1] as { values: unknown[] };
  assert.equal(calls[0][0], "$queryRaw");
  assert.deepEqual(sql.values, [now, japanDay, 100]);
});
