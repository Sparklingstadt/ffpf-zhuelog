import assert from "node:assert/strict";
import { test } from "node:test";

import {
  jstDayRange,
  likeContains,
} from "../src/infrastructure/prisma/learning-sql";

test("escapes LIKE wildcards", () => {
  assert.equal(likeContains("100%_a\\b"), "%100\\%\\_a\\\\b%");
  assert.equal(likeContains("你好"), "%你好%");
});

test("jstDayRange covers JST midnight to midnight", () => {
  const range = (year: number, month: number, day: number) => {
    const { start, end } = jstDayRange({ year, month, day });
    return [start.toISOString(), end.toISOString()];
  };
  assert.deepEqual(range(2026, 11, 16), [
    "2026-11-15T15:00:00.000Z",
    "2026-11-16T15:00:00.000Z",
  ]);
  assert.deepEqual(range(2026, 12, 31), [
    "2026-12-30T15:00:00.000Z",
    "2026-12-31T15:00:00.000Z",
  ]);
  assert.deepEqual(range(2028, 2, 29), [
    "2028-02-28T15:00:00.000Z",
    "2028-02-29T15:00:00.000Z",
  ]);
  assert.deepEqual(range(2027, 3, 1), [
    "2027-02-28T15:00:00.000Z",
    "2027-03-01T15:00:00.000Z",
  ]);
});
