import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type { LearningEntry } from "../src/domain/learning/entities/learning-entry";
import { CsvValidationError } from "../src/domain/learning/learning-csv";
import {
  checkCsvFile,
  importFileName,
  MAX_CSV_FILE_BYTES,
  parseLearningCsv,
} from "../src/infrastructure/csv/learning-csv";
import { toLearningCsv } from "../src/presentation/presenters/learning-csv-export";

const FORMAT =
  "CSVの形式を確認してください。引用符が閉じていないか、1行が長すぎる可能性があります。";
const LIMIT = "上限（各項目1万文字・ヒント100列）を超えています。";
const REQUIRED = "の「最初の文」「添削後の文」「ピンイン」は必須です。";

// The message parseLearningCsv rejects text with; fails on any other error.
function errorOf(text: string): string {
  try {
    parseLearningCsv(text);
  } catch (error) {
    if (error instanceof CsvValidationError) return error.message;
    throw error;
  }
  assert.fail("expected a CsvValidationError");
}

test("matches every fixture in tests/fixtures/learning-csv", async () => {
  const dir = join(import.meta.dirname, "fixtures", "learning-csv");
  const expected = JSON.parse(
    readFileSync(join(dir, "expected.json"), "utf8"),
  ) as Record<string, { entries?: unknown; error?: string }>;
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".csv"))
    .sort();
  assert.equal(names.length, Object.keys(expected).length);

  for (const name of names) {
    const want = expected[name];
    assert.ok(want, `no expected result for ${name}`);
    // Decoded like the server action decodes the upload (File.text()).
    const text = await new Blob([readFileSync(join(dir, name))]).text();
    if (want.error !== undefined) {
      assert.equal(errorOf(text), want.error, name);
    } else {
      assert.deepEqual(
        { entries: parseLearningCsv(text) },
        { entries: want.entries },
        name,
      );
    }
  }
});

test("enforces the row, cell and column limits", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => `o${i + 1},c,p\n`).join("");
  const hints = (n: number) => Array(n).fill("h").join(",");

  const bad: [string, string, string][] = [
    ["1001 rows", rows(1001), "一度にインポートできるのは1000件までです。"],
    [
      "1001 rows after a header",
      "original,corrected,pinyin\n" + rows(1001),
      "一度にインポートできるのは1000件までです。",
    ],
    [
      "10001-character cell",
      "a,b,c\nx," + "字".repeat(10_001) + ",z\n",
      "2行目は" + LIMIT,
    ],
    ["104 columns", "a,b,c," + hints(101) + "\n", "1行目は" + LIMIT],
    ["no data rows", "", "CSVにデータ行がありません。"],
    [
      "header only",
      "最初の文,添削後の文,ピン音\n",
      "CSVにデータ行がありません。",
    ],
    [
      "header with ピンイン",
      "最初の文,添削後の文,ピンイン\n",
      "CSVにデータ行がありません。",
    ],
    ["fewer than 3 columns", "a,b,c\nx,y\n", "2行目は3列未満です。"],
    [
      "empty required cell",
      "原文,添削文,拼音\na,b,c\na,b,　\n",
      "3行目" + REQUIRED,
    ],
    [
      "record over 100000 bytes",
      ("a".repeat(9_999) + ",").repeat(11) + "\n",
      FORMAT,
    ],
    ["unclosed quote", 'a,b,"c\n', FORMAT],
  ];
  for (const [name, text, want] of bad) {
    assert.equal(errorOf(text), want, name);
  }

  const ok: [string, string, number][] = [
    ["1000 rows", rows(1000), 1000],
    ["10000-character cell", "x," + "字".repeat(10_000) + ",z\n", 1],
    ["100 hints", "a,b,c," + hints(100) + "\n", 1],
  ];
  for (const [name, text, count] of ok) {
    assert.equal(parseLearningCsv(text).length, count, name);
  }
});

test("checks run in a fixed order", () => {
  // The row count is checked before any row.
  assert.equal(
    errorOf("a,b\n" + "a,b,c\n".repeat(1000)),
    "一度にインポートできるのは1000件までです。",
  );
  // Every row check wins over NUL, which is looked for last.
  assert.equal(errorOf("a\0,b,c\nd,e\n"), "2行目は3列未満です。");
  for (const text of ["a\0b,c,d\n", "a,b,c,h\0\n", "a,b,c\nd,e,\0f\n"]) {
    assert.equal(errorOf(text), FORMAT, JSON.stringify(text));
  }
});

test("numbers rows by record, not by line", () => {
  // A blank line is skipped and a quoted line break stays in its record, so
  // the third record is reported as row 3 although it ends on line 6.
  assert.equal(errorOf('a,b,c\n\nd,e,f\n"x\ny",b,\n'), "3行目" + REQUIRED);
});

test("reads back what the export writes", () => {
  const entry: LearningEntry = {
    id: "e1",
    kind: "correction",
    originalText: 'He said "hi", then\nleft',
    correctedText: "a,b",
    pinyin: "pīn yīn",
    createdAt: new Date("2026-11-16T00:00:00.000Z"),
    sharedAt: null,
    hints: [
      { id: "h1", content: "first, hint", position: 0 },
      { id: "h2", content: 'second "hint"', position: 1 },
    ],
  };
  assert.deepEqual(parseLearningCsv("﻿" + toLearningCsv([entry])), [
    {
      originalText: entry.originalText,
      correctedText: entry.correctedText,
      pinyin: entry.pinyin,
      hints: ["first, hint", 'second "hint"'],
    },
  ]);
});

test("checkCsvFile", () => {
  assert.equal(
    checkCsvFile({ name: "a.csv", size: 0 }),
    "CSVファイルを選択してください。",
  );
  assert.equal(MAX_CSV_FILE_BYTES, 4 * 1024 * 1024);
  assert.equal(checkCsvFile({ name: "a.csv", size: MAX_CSV_FILE_BYTES }), null);
  assert.equal(
    checkCsvFile({ name: "a.txt", size: MAX_CSV_FILE_BYTES + 1 }),
    "ファイルは4MB以下にしてください。",
  );
  assert.equal(checkCsvFile({ name: "Notes.CSV", size: 1 }), null);
  for (const name of ["a.csv.txt", "acsv"]) {
    assert.equal(
      checkCsvFile({ name, size: 1 }),
      "拡張子が.csvのファイルを選択してください。",
      name,
    );
  }
});

test("importFileName", () => {
  assert.equal(importFileName("字".repeat(300)), "字".repeat(255));
  assert.throws(
    () => importFileName("a\0.csv"),
    (error) => error instanceof CsvValidationError && error.message === FORMAT,
  );
});
