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
    ffpfAccount: counter("ffpf", 0),
  } as unknown as PrismaClient;
  const store = createLineLinkStore(() => db);

  assert.equal(await store.memberExists("password:c1"), true);
  assert.equal(await store.memberExists("ffpf:s1"), false);
  assert.deepEqual(calls, [
    { table: "password", args: { where: { id: "c1" } } },
    { table: "ffpf", args: { where: { id: "s1" } } },
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
