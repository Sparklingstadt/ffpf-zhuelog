import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aiUsageFeatureLabel,
  aiUsageMonthOf,
  aiUsageMonthRange,
  isAiUsageMonth,
  shiftAiUsageMonth,
  summarizeAiUsage,
  type AiUsageTotal,
} from "../src/domain/ai-usage/monthly-usage";

const row = (over: Partial<AiUsageTotal>): AiUsageTotal => ({
  ownerId: "password:a",
  displayName: "花子",
  feature: "line",
  model: "gpt-5-mini",
  requests: 1,
  inputTokens: 10,
  outputTokens: 5,
  ...over,
});

test("summarizeAiUsage groups rows by person in the store's order and adds them up", () => {
  const summary = summarizeAiUsage([
    row({
      ownerId: "12345",
      displayName: "",
      feature: "chat",
      requests: 2,
      inputTokens: 900,
      outputTokens: 100,
    }),
    row({ feature: "line", requests: 3, inputTokens: 30, outputTokens: 15 }),
    row({
      feature: "vocabulary_draft",
      requests: 1,
      inputTokens: 5,
      outputTokens: 5,
    }),
  ]);
  assert.deepEqual(
    summary.people.map((p) => [
      p.name,
      p.requests,
      p.inputTokens,
      p.outputTokens,
      p.rows.length,
    ]),
    [
      ["管理者", 2, 900, 100, 1],
      ["花子", 4, 35, 20, 2],
    ],
  );
  assert.deepEqual(
    [summary.requests, summary.inputTokens, summary.outputTokens],
    [6, 935, 120],
  );
  assert.deepEqual(summarizeAiUsage([]).people, []);
});

test("feature labels are Japanese and unknown features pass through", () => {
  assert.equal(aiUsageFeatureLabel("line"), "LINE の添削・翻訳");
  assert.equal(aiUsageFeatureLabel("quick_question"), "クイック質問");
  assert.equal(aiUsageFeatureLabel("something_new"), "something_new");
});

test("months are YYYY-MM and shift across years", () => {
  assert.ok(isAiUsageMonth("2026-11"));
  for (const bad of [
    "2026-13",
    "2026-00",
    "2026-1",
    "1999-12",
    "2026-11-01",
    "",
  ])
    assert.ok(!isAiUsageMonth(bad), bad);
  assert.equal(shiftAiUsageMonth("2026-01", -1), "2025-12");
  assert.equal(shiftAiUsageMonth("2026-12", 1), "2027-01");
  assert.equal(shiftAiUsageMonth("2026-11", 1), "2026-12");
});

test("AI usage months are Japan months", () => {
  assert.deepEqual(aiUsageMonthRange("2026-11"), {
    from: new Date("2026-10-31T15:00:00.000Z"),
    to: new Date("2026-11-30T15:00:00.000Z"),
  });
  assert.deepEqual(
    aiUsageMonthRange("2026-12").to,
    new Date("2026-12-31T15:00:00.000Z"),
  );
  assert.deepEqual(
    aiUsageMonthRange("2027-01").from,
    new Date("2026-12-31T15:00:00.000Z"),
  );
  assert.throws(() => aiUsageMonthRange("2026-13"), RangeError);
  assert.throws(() => aiUsageMonthRange("1999-12"), RangeError);
  assert.throws(() => aiUsageMonthRange("2026-00"), RangeError);
  assert.throws(() => aiUsageMonthRange("2026-1"), RangeError);
  assert.throws(() => aiUsageMonthRange("2026-11-01"), RangeError);
  // The first and the last month that are accepted.
  assert.deepEqual(aiUsageMonthRange("2000-01"), {
    from: new Date("1999-12-31T15:00:00.000Z"),
    to: new Date("2000-01-31T15:00:00.000Z"),
  });
  assert.deepEqual(aiUsageMonthRange("9999-12"), {
    from: new Date("9999-11-30T15:00:00.000Z"),
    to: new Date("9999-12-31T15:00:00.000Z"),
  });

  assert.equal(aiUsageMonthOf(new Date("2026-10-31T15:00:00.000Z")), "2026-11");
  assert.equal(aiUsageMonthOf(new Date("2026-10-31T14:59:59.999Z")), "2026-10");
  assert.equal(aiUsageMonthOf(new Date("2026-12-31T15:00:00.000Z")), "2027-01");
});
