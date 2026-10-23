import assert from "node:assert/strict";
import { test } from "node:test";

import type { LearningEntry } from "../src/domain/learning/entities/learning-entry";
import {
  learningCsvFileName,
  toLearningCsv,
} from "../src/presentation/presenters/learning-csv-export";

function entry(
  originalText: string,
  correctedText: string,
  pinyin: string,
  hints: string[],
): LearningEntry {
  return {
    id: originalText,
    kind: "correction",
    originalText,
    correctedText,
    pinyin,
    createdAt: new Date("2026-10-22T03:04:05.000Z"),
    sharedAt: null,
    // Out of order on purpose: the CSV follows position.
    hints: hints
      .map((content, position) => ({ id: `h${position}`, content, position }))
      .reverse(),
  };
}

test("writes the import format: a header, then one quoted row per note", () => {
  const csv = toLearningCsv([
    entry("我去", "我去了", "wǒ qù le", ["了は完了"]),
    entry("他很高", "他很高。", "tā hěn gāo", []),
  ]);
  assert.equal(
    csv,
    [
      '"最初の文","添削後の文","ピン音","ヒント1"',
      '"我去","我去了","wǒ qù le","了は完了"',
      '"他很高","他很高。","tā hěn gāo"',
      "",
    ].join("\r\n"),
  );
});

test("the header has as many hint columns as the note with the most hints", () => {
  const csv = toLearningCsv([
    entry("a", "b", "c", ["1"]),
    entry("d", "e", "f", ["1", "2", "3"]),
  ]);
  assert.equal(
    csv.split("\r\n")[0],
    '"最初の文","添削後の文","ピン音","ヒント1","ヒント2","ヒント3"',
  );
  assert.equal(csv.split("\r\n")[1], '"a","b","c","1"');
});

test("hints follow their position", () => {
  const csv = toLearningCsv([entry("a", "b", "c", ["first", "second"])]);
  assert.equal(csv.split("\r\n")[1], '"a","b","c","first","second"');
});

test("quotes, commas and line breaks stay inside one field", () => {
  const csv = toLearningCsv([entry('他说"好"', "一,二", "line1\nline2", [])]);
  assert.equal(
    csv.split("\r\n").slice(1).join("\r\n"),
    '"他说""好""","一,二","line1\nline2"\r\n',
  );
});

test("no notes still gives the header", () => {
  assert.equal(toLearningCsv([]), '"最初の文","添削後の文","ピン音"\r\n');
});

test("the file name carries the Japan date", () => {
  // 2026-10-22 23:30 in Tokyo.
  assert.equal(
    learningCsvFileName(new Date("2026-10-22T14:30:00.000Z")),
    "xuexilu-2026-10-22.csv",
  );
  // 2026-10-23 00:30 in Tokyo, still the 22nd in UTC.
  assert.equal(
    learningCsvFileName(new Date("2026-10-22T15:30:00.000Z")),
    "xuexilu-2026-10-23.csv",
  );
});
