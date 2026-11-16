import assert from "node:assert/strict";
import { test } from "node:test";

import {
  studyDayFromRow,
  studyLogSql,
} from "../src/infrastructure/prisma/study-log-store";

test("studyLogSql counts the five kinds as Go did", () => {
  const start = new Date("2026-10-26T15:00:00.000Z");
  const end = new Date("2026-12-06T15:00:00.000Z");
  const sql = studyLogSql("password:a", start, end);
  // `text` numbers the values as Postgres does ($1, $2, ...); `sql` uses "?".
  const text = sql.text.replace(/\s+/g, " ");
  for (const part of [
    'FROM "ReviewLog" WHERE "ownerId" = $1 AND "reviewedAt" >= $2 AND "reviewedAt" < $3',
    'FROM "PrepositionPracticeRecord"',
    'FROM "ComplementPracticeRecord"',
    'FROM "LearningEntry" WHERE "ownerId" = $10 AND "deletedAt" IS NULL AND "createdAt" >= $11 AND "createdAt" < $12',
    'FROM "VocabularyEntry"',
    `("reviewedAt" + interval '9 hours')::date`,
    'GROUP BY "day" ORDER BY "day"',
    `to_char("day", 'YYYY-MM-DD')`,
  ]) {
    assert.ok(text.includes(part), `${part}\n${text}`);
  }
  assert.equal(text.split('0, "questionCount", 0, 0').length - 1, 2, text);
  assert.equal(text.split('"deletedAt" IS NULL').length - 1, 1, text);
  assert.doesNotMatch(text, /AT TIME ZONE/);
  assert.deepEqual(
    sql.values,
    Array.from({ length: 5 }, () => ["password:a", start, end]).flat(),
  );
});

test("studyDayFromRow turns the sums into numbers", () => {
  assert.deepEqual(
    studyDayFromRow({
      date: "2026-11-02",
      reviews: BigInt(5),
      practiceQuestions: BigInt(25),
      notes: BigInt(1),
      words: BigInt(2),
    }),
    {
      date: "2026-11-02",
      reviews: 5,
      practiceQuestions: 25,
      notes: 1,
      words: 2,
    },
  );
});
