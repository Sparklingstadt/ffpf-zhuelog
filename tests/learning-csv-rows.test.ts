import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LearningCsvDraft } from "../src/domain/learning/learning-csv";
import {
  chunks,
  importRows,
} from "../src/infrastructure/prisma/learning-csv-import";

const NOW = new Date("2026-11-16T00:00:00.000Z");

function counter() {
  let n = 0;
  return () => `id${++n}`;
}

function draft(hints: string[] = []): LearningCsvDraft {
  return { originalText: "o", correctedText: "c", pinyin: "p", hints };
}

describe("importRows", () => {
  it("spaces notes 1 ms apart in input order", () => {
    const rows = importRows(
      "u1",
      "a.csv",
      [draft(), draft(), draft()],
      NOW,
      counter(),
    );
    assert.deepEqual(
      rows.entries.map((e) => e.createdAt.toISOString()),
      [
        "2026-11-16T00:00:00.000Z",
        "2026-11-16T00:00:00.001Z",
        "2026-11-16T00:00:00.002Z",
      ],
    );
    assert.equal(rows.batch.importedAt, NOW);
    assert.equal(rows.batch.rowCount, 3);
    assert.equal(rows.batch.fileName, "a.csv");
    assert.ok(rows.entries.every((e) => e.kind === "correction"));
    assert.ok(rows.entries.every((e) => e.ownerId === "u1"));
    assert.ok(rows.entries.every((e) => e.batchId === rows.batch.id));
    const ids = [rows.batch.id, ...rows.entries.map((e) => e.id)];
    assert.equal(new Set(ids).size, 4);
  });

  it("numbers each note's hints from 0", () => {
    const rows = importRows(
      "u1",
      "a.csv",
      [draft(["h1", "h2"]), draft()],
      NOW,
      counter(),
    );
    assert.equal(rows.hints.length, 2);
    assert.deepEqual(
      rows.hints.map((h) => [h.content, h.position]),
      [
        ["h1", 0],
        ["h2", 1],
      ],
    );
    assert.ok(
      rows.hints.every((h) => h.learningEntryId === rows.entries[0].id),
    );
  });
});

describe("chunks", () => {
  it("keep every hint in order", () => {
    const items = Array.from({ length: 100_000 }, (_, i) => i);
    const parts = chunks(items, 5_000);
    assert.equal(parts.length, 20);
    assert.deepEqual(parts.flat(), items);
  });

  it("returns the remainder as a last, shorter chunk", () => {
    assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });

  it("rejects a size that would never advance", () => {
    assert.throws(() => chunks([1], 0), RangeError);
    assert.throws(() => chunks([1], -1), RangeError);
  });
});
