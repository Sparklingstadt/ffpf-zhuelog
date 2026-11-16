import assert from "node:assert/strict";
import { test } from "node:test";

import {
  REVIEW_HISTORY_DAYS,
  japanDate,
  japanMidnightBefore,
  recentReviewDays,
  reviewStreak,
} from "../src/domain/review/review-days";

const HOUR = 60 * 60 * 1000;

test("streak counts Japan days and lasts until a whole day is missed", () => {
  // Answers on Oct 18, 19 (00:10 JST, still Oct 18 in UTC) and 20, JST.
  const reviewed = [
    "2026-10-18T03:00:00Z",
    "2026-10-18T15:10:00Z",
    "2026-10-20T01:00:00Z",
  ].map((at) => japanDate(new Date(at)));
  assert.deepEqual(reviewed, ["2026-10-18", "2026-10-19", "2026-10-20"]);

  // 2026-10-20 23:30 JST.
  const now = new Date("2026-10-20T14:30:00Z");
  assert.equal(reviewStreak(japanDate(now), reviewed), 3);
  assert.equal(reviewStreak(japanDate(now), []), 0);
  // Oct 21 JST without a review yet: the streak still stands.
  const later = new Date(now.getTime() + 2 * HOUR);
  assert.equal(reviewStreak(japanDate(later), reviewed), 3);
  // Oct 22 JST: a whole day missed.
  const missed = new Date(now.getTime() + 26 * HOUR);
  assert.equal(reviewStreak(japanDate(missed), reviewed), 0);
});

test("the streak table", () => {
  const today = "2026-11-01";
  const cases: [string, string[], number][] = [
    ["none", [], 0],
    ["today only", ["2026-11-01"], 1],
    ["yesterday only", ["2026-10-31"], 1],
    ["across the month", ["2026-11-01", "2026-10-31", "2026-10-30"], 3],
    ["a gap", ["2026-11-01", "2026-10-30"], 1],
    ["two days ago", ["2026-10-30", "2026-10-29"], 0],
    ["from yesterday on", ["2026-10-31", "2026-10-30", "2026-10-28"], 2],
  ];
  for (const [name, days, want] of cases) {
    assert.equal(reviewStreak(today, days), want, name);
    // The order the dates come in does not matter.
    assert.equal(reviewStreak(today, [...days].reverse()), want, name);
  }
});

test("recent days are the last 7 Japan days, oldest first", () => {
  assert.deepEqual(
    recentReviewDays("2026-10-20", ["2026-10-20", "2026-10-14"]),
    [true, false, false, false, false, false, true],
  );
  // 7 days back and tomorrow are outside the window.
  assert.deepEqual(
    recentReviewDays("2026-10-20", ["2026-10-13", "2026-10-21"]),
    [false, false, false, false, false, false, false],
  );
  // Across a month and a year: 2026-12-27 to 2027-01-02.
  assert.deepEqual(
    recentReviewDays("2027-01-02", ["2026-12-27", "2026-12-31", "2027-01-01"]),
    [true, false, false, false, true, true, false],
  );
  assert.equal(recentReviewDays("2026-10-20", [], 3).length, 3);
});

test("japanMidnightBefore", () => {
  assert.equal(
    japanMidnightBefore("2026-11-05", 0).toISOString(),
    "2026-11-04T15:00:00.000Z",
  );
  assert.equal(REVIEW_HISTORY_DAYS, 400);
  // 400 days before 2026-11-05 is 2025-10-01.
  assert.equal(
    japanMidnightBefore("2026-11-05", REVIEW_HISTORY_DAYS).toISOString(),
    "2025-09-30T15:00:00.000Z",
  );
});

test("japanDate turns over at JST midnight", () => {
  assert.equal(japanDate(new Date("2026-10-19T14:59:59.999Z")), "2026-10-19");
  assert.equal(japanDate(new Date("2026-10-19T15:00:00.000Z")), "2026-10-20");
});
