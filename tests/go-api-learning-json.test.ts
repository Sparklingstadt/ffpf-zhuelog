import assert from "node:assert/strict";
import { test } from "node:test";
import { toLearningEntry } from "../src/infrastructure/go-api/learning-json";

const base = {
  id: "e1",
  kind: "translation",
  originalText: "我去",
  correctedText: "我去了",
  pinyin: "wǒ qù le",
  hints: [
    { id: "h2", content: "二", position: 1 },
    { id: "h1", content: "一", position: 0 },
  ],
  createdAt: "2026-10-22T03:04:05.000Z",
  sharedAt: null,
};

test("toLearningEntry turns the Go entry JSON into a LearningEntry", () => {
  const entry = toLearningEntry(base);
  assert.deepEqual(entry, {
    id: "e1",
    kind: "translation",
    originalText: "我去",
    correctedText: "我去了",
    pinyin: "wǒ qù le",
    createdAt: new Date("2026-10-22T03:04:05.000Z"),
    sharedAt: null,
    hints: [
      { id: "h1", content: "一", position: 0 },
      { id: "h2", content: "二", position: 1 },
    ],
  });
});

test("toLearningEntry parses sharedAt and drops extra fields", () => {
  const entry = toLearningEntry({
    ...base,
    sharedAt: "2026-10-22T05:00:00.000Z",
    deletedAt: "2026-10-22T06:00:00.000Z",
    number: 3,
  } as Parameters<typeof toLearningEntry>[0]);
  assert.deepEqual(entry.sharedAt, new Date("2026-10-22T05:00:00.000Z"));
  assert.equal("deletedAt" in entry, false);
  assert.equal("number" in entry, false);
});

test("toLearningEntry rejects an unknown kind and a bad date", () => {
  assert.throws(() => toLearningEntry({ ...base, kind: "poem" }));
  assert.throws(() => toLearningEntry({ ...base, createdAt: "yesterday" }));
});
