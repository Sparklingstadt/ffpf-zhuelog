import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getTokyoDateParts,
  parseLogDate,
  parseLogNumber,
} from "../src/domain/calendar/value-objects/log-date";

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

test("Japan date parts switch at 15:00 UTC", () => {
  assert.deepEqual(getTokyoDateParts(new Date("2026-10-03T15:00:00Z")), {
    year: 2026,
    month: 10,
    day: 4,
  });
  assert.deepEqual(getTokyoDateParts(new Date("2026-10-04T14:59:59.999Z")), {
    year: 2026,
    month: 10,
    day: 4,
  });
  assert.deepEqual(getTokyoDateParts(new Date("2026-10-04T15:00:00Z")), {
    year: 2026,
    month: 10,
    day: 5,
  });
});
