import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatMonthParam,
  monthCells,
  parseMonthParam,
  shiftMonth,
} from "../src/presentation/presenters/note-calendar-presenter";

test("a month param reads and writes as YYYY-MM", () => {
  assert.deepEqual(parseMonthParam("2026-09"), { year: 2026, month: 9 });
  assert.equal(formatMonthParam({ year: 2026, month: 9 }), "2026-09");
  for (const bad of ["2026-13", "2026-9", "26-09", undefined, ["2026-09"]])
    assert.equal(parseMonthParam(bad), null);
});

test("months shift across years", () => {
  assert.deepEqual(shiftMonth({ year: 2026, month: 1 }, -1), {
    year: 2025,
    month: 12,
  });
  assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), {
    year: 2027,
    month: 1,
  });
});

test("a month is whole weeks from Monday, with each day's count", () => {
  // 2026-11-01 is a Sunday: six blanks lead.
  const cells = monthCells({ year: 2026, month: 11 }, [
    { date: { year: 2026, month: 11, day: 12 }, count: 3 },
    { date: { year: 2026, month: 10, day: 12 }, count: 9 },
  ]);
  assert.equal(cells.length % 7, 0);
  assert.equal(
    cells.findIndex((c) => c.kind === "day"),
    6,
  );
  const days = cells.filter((c) => c.kind === "day");
  assert.equal(days.length, 30);
  assert.equal(days[11].kind === "day" && days[11].count, 3);
  assert.equal(
    days.reduce((n, c) => n + (c.kind === "day" ? c.count : 0), 0),
    3,
  );
});
