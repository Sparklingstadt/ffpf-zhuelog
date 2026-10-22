import assert from "node:assert/strict";
import { test } from "node:test";
import {
  recentEntriesTotal,
  recentEntryNumberLabel,
} from "../src/presentation/presenters/recent-entry-number";

test("numbers count down from the total", () => {
  assert.equal(recentEntriesTotal(250, 100), 250);
  assert.deepEqual(
    [0, 1, 99].map((index) => recentEntryNumberLabel(250, 100, index)),
    ["#250", "#249", "#151"],
  );
});

test("a total below the shown count never gives a number under 1", () => {
  assert.equal(recentEntriesTotal(2, 3), 3);
  assert.deepEqual(
    [0, 1, 2].map((index) => recentEntryNumberLabel(2, 3, index)),
    ["#3", "#2", "#1"],
  );
  assert.equal(recentEntryNumberLabel(0, 0, 5), "#1");
});
