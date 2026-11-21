import assert from "node:assert/strict";
import { test } from "node:test";

import { checkPracticeRound } from "../src/domain/practice/practice-round";
import { practiceRecordRow } from "../src/infrastructure/prisma/practice-record-store";

test("practiceRecordRow keeps Go's counts and question JSON", () => {
  const startedAt = new Date("2026-11-16T08:55:00.000Z");
  const now = new Date("2026-11-16T09:00:00.000Z");
  const round = checkPracticeRound("preposition", {
    id: "0b6c3f2e-1d4a-4c8e-9f00-123456789abc",
    startedAt,
    elapsedMs: 300_000,
    questions: [
      {
        id: "P001",
        answer: "在",
        noun: "学校",
        prompt: "我___学校。",
        misses: ["从", "对"],
      },
      { answer: "给", noun: "朋友", prompt: "我___朋友打电话。", misses: [] },
      {
        id: "",
        answer: "跟",
        noun: "老师",
        prompt: "我___老师学。",
        misses: [],
      },
    ],
  });
  assert.ok(round);

  const row = practiceRecordRow("github:1", round, now);
  assert.equal(row.id, "0b6c3f2e-1d4a-4c8e-9f00-123456789abc");
  assert.equal(row.ownerId, "github:1");
  assert.equal(row.questionCount, 3);
  assert.equal(row.firstTryCount, 2);
  assert.equal(row.missCount, 2);
  assert.equal(row.elapsedMs, 300_000);
  assert.equal(row.startedAt, startedAt);
  assert.equal(row.createdAt, now);

  const raw = JSON.stringify(row.questions);
  // Only the question with an id names one (Go's
  // strings.Count(raw, "\"id\"") == 1).
  assert.equal(raw.split('"id"').length - 1, 1);
  assert.deepEqual(JSON.parse(raw), [
    {
      id: "P001",
      answer: "在",
      noun: "学校",
      prompt: "我___学校。",
      misses: ["从", "对"],
    },
    { answer: "给", noun: "朋友", prompt: "我___朋友打电话。", misses: [] },
    { answer: "跟", noun: "老师", prompt: "我___老师学。", misses: [] },
  ]);
});
