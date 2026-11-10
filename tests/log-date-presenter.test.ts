import assert from "node:assert/strict";
import { test } from "node:test";

import { formatTokyoTime } from "../src/presentation/presenters/log-date-presenter";

test("formatTokyoTime shows the hour and minute in Tokyo", () => {
  // 12:10 UTC is 21:10 in Tokyo; 15:05 UTC is past midnight there.
  assert.equal(formatTokyoTime(new Date("2026-11-09T12:10:00Z")), "21:10");
  assert.equal(formatTokyoTime(new Date("2026-11-09T15:05:00Z")), "00:05");
});
