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

test("memberDirectorySql lists the members as Go did", () => {
  const sql = memberDirectorySql("password:me");
  const text = flat(sql);
  for (const part of [
    `'password:' || p."id"`,
    `'ffpf:' || f."id"`,
    "UNION ALL",
    `f."followerId" = $1 AND f."followeeId" = a."ownerId"`,
    `f."followerId" = a."ownerId" AND f."followeeId" = $2`,
    `WHERE a."ownerId" <> $3`,
    `ORDER BY a."displayName" COLLATE "ja-x-icu", a."createdAt", a."ownerId"`,
    `AS "following"`,
    `AS "followsMe"`,
  ]) {
    assert.ok(text.includes(part), `${part}\n${text}`);
  }
  assert.ok(!text.includes(`"loginId"`), text);
  assert.deepEqual(sql.values, ["password:me", "password:me", "password:me"]);

  const count = followerCountSql("password:me");
  assert.ok(flat(count).includes(`FROM "Follow" WHERE "followeeId" = $1`));
  assert.deepEqual(count.values, ["password:me"]);
});

test("directoryFromRows counts as Go did", () => {
  const rows = [
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
    { ownerId: "ffpf:c", displayName: "C", following: false, followsMe: true },
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
        ownerId: "ffpf:c",
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

test("timelineSql reads the shared notes as Go did", () => {
  const sql = timelineSql("password:me", 100);
  const text = flat(sql);
  for (const part of [
    `JOIN "Follow" f ON f."followeeId" = e."ownerId" AND f."followerId" = $1`,
    `ON a."ownerId" = e."ownerId"`,
    `e."sharedAt" IS NOT NULL AND e."deletedAt" IS NULL`,
    `ORDER BY e."createdAt" DESC, e."id" DESC`,
    "LIMIT $2",
    `AS "ownerName"`,
    `'password:'`,
    `'ffpf:'`,
    "UNION ALL",
  ]) {
    assert.ok(text.includes(part), `${part}\n${text}`);
  }
  assert.deepEqual(sql.values, ["password:me", 100]);
});

test("followSql adds a row only for an existing member", () => {
  const now = new Date("2026-11-17T03:00:00.000Z");

  const password = followSql("10001", "password:abc", now);
  const text = flat(password);
  for (const part of [
    `FROM "PasswordAccount" WHERE "id" = $1`,
    `INSERT INTO "Follow" ("followerId", "followeeId", "createdAt")`,
    `WHERE EXISTS (SELECT 1 FROM "target")`,
    "ON CONFLICT DO NOTHING",
    `SELECT EXISTS (SELECT 1 FROM "target") AS "member"`,
  ]) {
    assert.ok(text.includes(part), `${part}\n${text}`);
  }
  assert.ok(!text.includes(`"FfpfAccount"`), text);
  assert.deepEqual(password.values, ["abc", "10001", "password:abc", now]);

  const ffpf = followSql("password:me", "ffpf:cabc", now);
  assert.ok(flat(ffpf).includes(`FROM "FfpfAccount" WHERE "id" = $1`));
  assert.ok(!flat(ffpf).includes(`"PasswordAccount"`));
  assert.deepEqual(ffpf.values, ["cabc", "password:me", "ffpf:cabc", now]);

  assert.throws(() => followSql("password:me", "github:1", now), RangeError);
  assert.throws(() => followSql("password:me", "password:", now), RangeError);
});
