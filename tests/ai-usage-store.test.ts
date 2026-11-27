import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aiUsageMonthSql,
  aiUsageTotalFromRow,
} from "../src/infrastructure/prisma/ai-usage-store";

test("aiUsageMonthSql orders people by their tokens in the database", () => {
  const from = new Date("2026-10-31T15:00:00.000Z");
  const to = new Date("2026-11-30T15:00:00.000Z");
  const sql = aiUsageMonthSql(from, to);
  // `text` numbers the values as Postgres does ($1, $2, ...); `sql` uses "?".
  const text = sql.text.replace(/\s+/g, " ");
  for (const part of [
    `CASE WHEN coalesce(u."role", 'user') <> 'admin' AND NOT coalesce(u."isAnonymous", false) THEN u."name" ELSE '' END AS "displayName"`,
    'JOIN "user" u ON u."id" = a."userId"',
    'AS "userId"',
    'AS "feature"',
    'AS "model"',
    'AS "requests"',
    'AS "inputTokens"',
    'AS "outputTokens"',
    'WHERE a."createdAt" >= $1 AND a."createdAt" < $2',
    'GROUP BY a."userId", u."name", u."role", u."isAnonymous", a."feature", a."model"',
    'ORDER BY sum(sum(a."inputTokens" + a."outputTokens")) OVER (PARTITION BY a."userId") DESC, a."userId", a."feature", a."model"',
  ]) {
    assert.ok(text.includes(part), `${part}\n${text}`);
  }
  assert.deepEqual(sql.values, [from, to]);
});

test("aiUsageTotalFromRow turns the sums into numbers", () => {
  assert.deepEqual(
    aiUsageTotalFromRow({
      userId: "u-a",
      displayName: "花子",
      feature: "line",
      model: "gpt-5-mini",
      requests: BigInt(3),
      inputTokens: BigInt(300),
      outputTokens: BigInt(120),
    }),
    {
      ownerId: "u-a",
      displayName: "花子",
      feature: "line",
      model: "gpt-5-mini",
      requests: 3,
      inputTokens: 300,
      outputTokens: 120,
    },
  );
});
