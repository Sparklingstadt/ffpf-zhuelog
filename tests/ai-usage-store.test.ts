import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aiUsageMonthSql,
  aiUsageTotalFromRow,
} from "../src/infrastructure/prisma/ai-usage-store";

test("aiUsageMonthSql orders people by their tokens as Go did", () => {
  const from = new Date("2026-10-31T15:00:00.000Z");
  const to = new Date("2026-11-30T15:00:00.000Z");
  const sql = aiUsageMonthSql(from, to);
  // `text` numbers the values as Postgres does ($1, $2, ...); `sql` uses "?".
  const text = sql.text.replace(/\s+/g, " ");
  for (const part of [
    `coalesce(m."displayName", '')`,
    `'password:' || p."id"`,
    `'ffpf:' || f."id"`,
    "LEFT JOIN",
    'WHERE u."createdAt" >= $1 AND u."createdAt" < $2',
    'GROUP BY u."ownerId", m."displayName", u."feature", u."model"',
    'ORDER BY sum(sum(u."inputTokens" + u."outputTokens")) OVER (PARTITION BY u."ownerId") DESC, u."ownerId", u."feature", u."model"',
  ]) {
    assert.ok(text.includes(part), `${part}\n${text}`);
  }
  assert.deepEqual(sql.values, [from, to]);
});

test("aiUsageTotalFromRow turns the sums into numbers", () => {
  assert.deepEqual(
    aiUsageTotalFromRow({
      ownerId: "password:a",
      displayName: "花子",
      feature: "line",
      model: "gpt-5-mini",
      requests: BigInt(3),
      inputTokens: BigInt(300),
      outputTokens: BigInt(120),
    }),
    {
      ownerId: "password:a",
      displayName: "花子",
      feature: "line",
      model: "gpt-5-mini",
      requests: 3,
      inputTokens: 300,
      outputTokens: 120,
    },
  );
});
