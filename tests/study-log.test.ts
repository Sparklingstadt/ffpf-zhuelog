import assert from "node:assert/strict";
import test from "node:test";

import {
  monthGrid,
  parseMonth,
  shiftMonth,
  studyLevel,
  studyLogRange,
  summarize,
  todayInJapan,
} from "../src/domain/study-log/study-log";

test("a month's grid runs Monday to Sunday and covers whole weeks", () => {
  // November 2026 starts on a Sunday and has 30 days.
  const weeks = monthGrid({ year: 2026, month: 11 });
  assert.equal(weeks.length, 6);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.deepEqual(weeks[0][0], {
    date: "2026-10-26",
    day: 26,
    inMonth: false,
  });
  assert.deepEqual(weeks[0][6], { date: "2026-11-01", day: 1, inMonth: true });
  assert.deepEqual(weeks.at(-1)!.at(-1), {
    date: "2026-12-06",
    day: 6,
    inMonth: false,
  });
  assert.equal(weeks.flat().filter((c) => c.inMonth).length, 30);

  // February 2027 starts on a Monday and fits in four weeks exactly.
  const feb = monthGrid({ year: 2027, month: 2 });
  assert.equal(feb.length, 4);
  assert.equal(feb[0][0].date, "2027-02-01");
  assert.equal(feb[3][6].date, "2027-02-28");
});

test("months parse, shift across years and today is Japan's date", () => {
  assert.deepEqual(parseMonth("2026-11"), { year: 2026, month: 11 });
  for (const bad of [
    "2026-13",
    "2026-1",
    "1999-12",
    "x",
    undefined,
    ["2026-11"],
  ])
    assert.equal(parseMonth(bad), null);
  assert.deepEqual(shiftMonth({ year: 2026, month: 1 }, -1), {
    year: 2025,
    month: 12,
  });
  assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), {
    year: 2027,
    month: 1,
  });
  // 2026-11-05 15:30 UTC is already Nov 6 in Japan.
  assert.equal(todayInJapan(new Date("2026-11-05T15:30:00Z")), "2026-11-06");
  assert.equal(todayInJapan(new Date("2026-11-05T14:59:00Z")), "2026-11-05");
});

test("levels and the month's summary", () => {
  assert.deepEqual(
    [0, 1, 9, 10, 29, 30, 59, 60, 500].map(studyLevel),
    [0, 1, 1, 2, 2, 3, 3, 4, 4],
  );
  assert.deepEqual(
    summarize([
      {
        date: "2026-11-01",
        reviews: 3,
        practiceQuestions: 25,
        notes: 1,
        words: 0,
      },
      {
        date: "2026-11-02",
        reviews: 0,
        practiceQuestions: 0,
        notes: 0,
        words: 2,
      },
    ]),
    { reviews: 3, practiceQuestions: 25, notes: 1, words: 2, activeDays: 2 },
  );
});

test("study log ranges are Japan days, as Go read them", () => {
  assert.deepEqual(studyLogRange("2026-10-27", "2026-12-06"), {
    start: new Date("2026-10-26T15:00:00.000Z"),
    end: new Date("2026-12-06T15:00:00.000Z"),
  });
  assert.deepEqual(studyLogRange("2026-11-02", "2026-11-02"), {
    start: new Date("2026-11-01T15:00:00.000Z"),
    end: new Date("2026-11-02T15:00:00.000Z"),
  });
  // 93 days, both ends included, is the longest range.
  assert.notEqual(studyLogRange("2026-01-01", "2026-04-03"), null);
  assert.deepEqual(
    studyLogRange("2026-12-31", "2027-01-01")?.end,
    new Date("2027-01-01T15:00:00.000Z"),
  );
  const refused: [string, string][] = [
    ["2026-01-01", "2026-04-04"],
    ["2026-11-02", "2026-11-01"],
    ["", "2026-11-01"],
    ["2026-11-31", "2026-12-01"],
    ["2026-11-1", "2026-11-30"],
    ["1999-12-27", "2000-01-02"],
    ["9999-12-27", "10000-01-02"],
    ["2026-02-29", "2026-03-01"],
  ];
  for (const [from, to] of refused) {
    assert.equal(studyLogRange(from, to), null, `${from}..${to}`);
  }
});
