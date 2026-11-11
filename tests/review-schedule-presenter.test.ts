import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dueByGroup,
  formatInterval,
  formatNextReview,
  recentDays,
} from "../src/presentation/presenters/review-schedule-presenter";

const at = new Date("2026-11-11T03:00:00Z"); // 12:00 JST, a Wednesday

const after = (ms: number) => new Date(at.getTime() + ms);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

test("intervals read as minutes, hours, days, months and years", () => {
  assert.equal(formatInterval(at, after(10 * MIN)), "10分後");
  assert.equal(formatInterval(at, after(5_000)), "1分後");
  assert.equal(formatInterval(at, at), "1分後");
  assert.equal(formatInterval(at, after(3 * 60 * MIN)), "3時間後");
  assert.equal(formatInterval(at, after(DAY)), "1日後");
  assert.equal(formatInterval(at, after(4 * DAY)), "4日後");
  assert.equal(formatInterval(at, after(65 * DAY)), "2か月後");
  assert.equal(formatInterval(at, after(548 * DAY)), "1.5年後");
});

test("the next review goes by the Tokyo calendar day", () => {
  assert.equal(formatNextReview(after(-DAY), at), "今日");
  assert.equal(formatNextReview(after(10 * MIN), at), "今日");
  // 2026-11-12 00:30 JST.
  assert.equal(formatNextReview(new Date("2026-11-11T15:30:00Z"), at), "明日");
  assert.equal(formatNextReview(new Date("2026-11-20T00:00:00Z"), at), "11/20");
  assert.equal(
    formatNextReview(new Date("2027-01-05T00:00:00Z"), at),
    "2027/1/5",
  );
});

test("the recent days end with today and name the weekdays before it", () => {
  const days = recentDays([false, true, false, false, false, false, true], at);
  assert.deepEqual(
    days.map((d) => d.label),
    ["木", "金", "土", "日", "月", "火", "今日"],
  );
  assert.equal(days[0].date, "11/5（木）");
  assert.equal(days[6].date, "11/11（水）");
  assert.deepEqual(
    days.map((d) => d.reviewed),
    [false, true, false, false, false, false, true],
  );
});

test("due items are grouped as notes, practice misses and words", () => {
  assert.deepEqual(
    dueByGroup({ entry: 1, preposition: 2, complement: 3, vocabulary: 4 }),
    [
      { label: "学習ノート", count: 1 },
      { label: "練習の間違い", count: 5 },
      { label: "単語帳", count: 4 },
    ],
  );
  assert.deepEqual(dueByGroup({ vocabulary: 2 }), [
    { label: "単語帳", count: 2 },
  ]);
  // An unknown kind counts as practice.
  assert.deepEqual(dueByGroup({ "measure-word": 1 }), [
    { label: "練習の間違い", count: 1 },
  ]);
  assert.deepEqual(dueByGroup({}), []);
});
