import assert from "node:assert/strict";
import { test } from "node:test";

import {
  directoryFromRows,
  followSql,
  followerCountSql,
  memberDirectorySql,
  timelineSql,
} from "../src/infrastructure/prisma/social-store";

// Postgres placeholders ($1, $2, ...), as the statement is sent.
function flat(sql: { text: string }): string {
  return sql.text.replace(/\s+/g, " ");
}

const IS_MEMBER = `coalesce(u."role", 'user') <> 'admin' AND NOT coalesce(u."isAnonymous", false)`;

test("memberDirectorySql lists every member but the viewer", () => {
  const sql = memberDirectorySql("me");
  const text = flat(sql);
  for (const part of [
    `SELECT u."id" AS "userId", u."name" AS "displayName"`,
    `f."followerId" = $1 AND f."followeeId" = u."id"`,
    `f."followerId" = u."id" AND f."followeeId" = $2`,
    `FROM "user" u WHERE ${IS_MEMBER} AND u."id" <> $3`,
    `ORDER BY u."name" COLLATE "ja-x-icu", u."createdAt", u."id"`,
    `AS "following"`,
    `AS "followsMe"`,
  ]) {
    assert.ok(text.includes(part), `${part}\n${text}`);
  }
  assert.ok(!text.includes(`"username"`), text);
  assert.deepEqual(sql.values, ["me", "me", "me"]);

  const count = followerCountSql("me");
  assert.ok(flat(count).includes(`FROM "Follow" WHERE "followeeId" = $1`));
  assert.deepEqual(count.values, ["me"]);
});

test("directoryFromRows counts follows in both directions", () => {
  const rows = [
    {
      userId: "password:a",
      displayName: "A",
      following: true,
      followsMe: true,
    },
    {
      userId: "password:b",
      displayName: "B",
      following: true,
      followsMe: false,
    },
    { userId: "sid:c", displayName: "C", following: false, followsMe: true },
  ];
  assert.deepEqual(directoryFromRows(rows, BigInt(3)), {
    members: [
      {
        ownerId: "password:a",
        displayName: "A",
        following: true,
        followsMe: true,
      },
      {
        ownerId: "password:b",
        displayName: "B",
        following: true,
        followsMe: false,
      },
      {
        ownerId: "sid:c",
        displayName: "C",
        following: false,
        followsMe: true,
      },
    ],
    followingCount: 2,
    followerCount: 3,
  });
  assert.deepEqual(directoryFromRows([], BigInt(0)), {
    members: [],
    followingCount: 0,
    followerCount: 0,
  });
});

test("timelineSql reads the shared notes of the people the viewer follows", () => {
  const sql = timelineSql("me", 100);
  const text = flat(sql);
  for (const part of [
    `e."userId" AS "userId", u."name" AS "ownerName"`,
    `JOIN "Follow" f ON f."followeeId" = e."userId" AND f."followerId" = $1`,
    `JOIN "user" u ON u."id" = e."userId" AND ${IS_MEMBER}`,
    `e."sharedAt" IS NOT NULL AND e."deletedAt" IS NULL`,
    `ORDER BY e."createdAt" DESC, e."id" DESC`,
    "LIMIT $2",
  ]) {
    assert.ok(text.includes(part), `${part}\n${text}`);
  }
  assert.deepEqual(sql.values, ["me", 100]);
});

test("followSql adds a row only for an existing member", () => {
  const now = new Date("2026-11-17T03:00:00.000Z");

  const sql = followSql("admin1", "abc", now);
  const text = flat(sql);
  for (const part of [
    `WITH "target" AS (SELECT 1 FROM "user" u WHERE u."id" = $1 AND ${IS_MEMBER})`,
    `INSERT INTO "Follow" ("followerId", "followeeId", "createdAt")`,
    `WHERE EXISTS (SELECT 1 FROM "target")`,
    "ON CONFLICT DO NOTHING",
    `SELECT EXISTS (SELECT 1 FROM "target") AS "member"`,
  ]) {
    assert.ok(text.includes(part), `${part}\n${text}`);
  }
  assert.deepEqual(sql.values, ["abc", "admin1", "abc", now]);
});
