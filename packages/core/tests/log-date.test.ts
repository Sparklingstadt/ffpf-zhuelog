import assert from "node:assert/strict";
import { test } from "node:test";

import { ListLogDates } from "@ffpf-zhuelog/core/application/calendar/use-cases/list-log-dates";
import {
  getLogDateKey,
  getTokyoDateParts,
  getTokyoDateRange,
  parseLogDate,
  parseLogNumber,
} from "@ffpf-zhuelog/core/domain/calendar/value-objects/log-date";

test("parseLogDate accepts real calendar dates only", () => {
  assert.deepEqual(parseLogDate("2026", "10", "4"), {
    year: 2026,
    month: 10,
    day: 4,
  });
  assert.equal(parseLogDate("2026", "2", "29"), null);
  assert.equal(parseLogDate("1999", "1", "1"), null);
  assert.equal(parseLogDate("2026", "1", "x"), null);
});

test("parseLogDate accepts only the canonical form without leading zeros", () => {
  // Links use /2026/4/10; /2026/04/10 must not be a second URL for the page.
  assert.deepEqual(parseLogDate("2026", "4", "10"), {
    year: 2026,
    month: 4,
    day: 10,
  });
  assert.equal(parseLogDate("2026", "04", "10"), null);
  assert.equal(parseLogDate("2026", "10", "04"), null);
  assert.equal(parseLogDate("2026", "0", "1"), null);
});

test("parseLogNumber accepts positive 32-bit integers only", () => {
  assert.equal(parseLogNumber("1"), 1);
  assert.equal(parseLogNumber("0"), null);
  assert.equal(parseLogNumber("01"), null);
  assert.equal(parseLogNumber("2147483648"), null);
});

test("a log date covers one day in Japan time", () => {
  const { start, end } = getTokyoDateRange({ year: 2026, month: 10, day: 4 });
  assert.equal(start.toISOString(), "2026-10-03T15:00:00.000Z");
  assert.equal(end.toISOString(), "2026-10-04T15:00:00.000Z");
  assert.deepEqual(getTokyoDateParts(start), { year: 2026, month: 10, day: 4 });
  assert.equal(getLogDateKey(new Date(end.getTime() - 1)), "2026/10/4");
  assert.equal(getLogDateKey(end), "2026/10/5");
});

test("ListLogDates groups any timestamps by Japan date", async () => {
  const dates = await new ListLogDates({
    listCreatedAt: async () => [
      new Date("2026-10-04T14:59:59Z"),
      new Date("2026-10-03T15:00:00Z"),
      new Date("2026-10-04T15:00:00Z"),
    ],
  }).execute();
  assert.deepEqual(dates, [
    { date: { year: 2026, month: 10, day: 4 }, count: 2 },
    { date: { year: 2026, month: 10, day: 5 }, count: 1 },
  ]);
});
