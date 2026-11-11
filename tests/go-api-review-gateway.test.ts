import assert from "node:assert/strict";
import { test } from "node:test";

import type { GoApiCall } from "../src/infrastructure/go-api/authed";
import { createReviewGateway } from "../src/infrastructure/go-api/review-gateway";

function fakeCall(response: unknown) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const call = (async (
    path: string,
    init: { method: string; body?: unknown },
  ) => {
    calls.push({ path, method: init.method, body: init.body });
    return response;
  }) as GoApiCall;
  return { call, calls };
}

const itemJson = {
  id: "cabcdefghijklmnopqrstuvwx",
  language: "zh",
  kind: "preposition",
  targetId: "P001:学校",
  due: "2026-11-05T10:00:00.000Z",
  state: 2,
  reps: 3,
  lapses: 1,
  lastReview: "2026-11-01T09:00:00.000Z",
};

test("listDue asks for a limit and maps dates", async () => {
  const { call, calls } = fakeCall({
    count: 7,
    streakDays: 3,
    items: [itemJson, { ...itemJson, id: "c2", lastReview: null }],
  });
  const due = await createReviewGateway(call).listDue(20);
  assert.deepEqual(calls, [
    { path: "/v1/reviews/due?limit=20", method: "GET", body: undefined },
  ]);
  assert.equal(due.count, 7);
  assert.equal(due.streakDays, 3);
  assert.equal(due.items.length, 2);
  assert.deepEqual(due.items[0].due, new Date("2026-11-05T10:00:00.000Z"));
  assert.deepEqual(
    due.items[0].lastReview,
    new Date("2026-11-01T09:00:00.000Z"),
  );
  assert.equal(due.items[0].targetId, "P001:学校");
  assert.equal(due.items[1].lastReview, null);
  assert.equal(due.items[0].vocabulary, null);
});

test("a vocabulary item carries its word", async () => {
  const word = {
    id: "0b0c6f4e-5d2a-4c1b-9e3f-7a8b9c0d1e2f",
    language: "zh",
    word: "认真",
    pinyin: "rènzhēn",
    meaning: "まじめに",
    sourceEntryId: null,
    createdAt: "2026-11-05T12:00:00.000Z",
    updatedAt: "2026-11-05T12:00:00.000Z",
  };
  const { call } = fakeCall({
    count: 1,
    streakDays: 0,
    items: [
      { ...itemJson, kind: "vocabulary", targetId: word.id, vocabulary: word },
    ],
  });
  const due = await createReviewGateway(call).listDue(20);
  assert.deepEqual(due.items[0].vocabulary, {
    id: word.id,
    word: "认真",
    pinyin: "rènzhēn",
    meaning: "まじめに",
  });
});

test("answer POSTs the rating under the item, with the client's log id", async () => {
  const { call, calls } = fakeCall({ ...itemJson, reps: 4 });
  const item = await createReviewGateway(call).answer({
    itemId: "cabcdefghijklmnopqrstuvwx",
    logId: "0b0c6f4e-5d2a-4c1b-9e3f-7a8b9c0d1e2f",
    rating: 3,
  });
  assert.deepEqual(calls, [
    {
      path: "/v1/reviews/cabcdefghijklmnopqrstuvwx",
      method: "POST",
      body: { logId: "0b0c6f4e-5d2a-4c1b-9e3f-7a8b9c0d1e2f", rating: 3 },
    },
  ]);
  assert.equal(item.reps, 4);
});

test("a learning note's item carries the note", async () => {
  const entry = {
    id: "cnote0000000000000000000",
    kind: "correction",
    originalText: "我昨天去了学校。",
    correctedText: "我昨天去学校了。",
    pinyin: "Wǒ zuótiān qù xuéxiào le.",
    hints: [
      { id: "h2", content: "二つ目", position: 1 },
      { id: "h1", content: "了の位置", position: 0 },
    ],
    createdAt: "2026-11-05T12:00:00.000Z",
    sharedAt: null,
  };
  const { call } = fakeCall({
    count: 1,
    streakDays: 0,
    items: [{ ...itemJson, kind: "entry", targetId: entry.id, entry }],
  });
  const [item] = (await createReviewGateway(call).listDue(20)).items;
  assert.equal(item.vocabulary, null);
  assert.equal(item.entry?.correctedText, "我昨天去学校了。");
  assert.deepEqual(item.entry?.createdAt, new Date("2026-11-05T12:00:00.000Z"));
  assert.deepEqual(
    item.entry?.hints.map((hint) => hint.content),
    ["了の位置", "二つ目"],
  );
});

test("listDue carries the counts by kind, the recent days and each item's next dues", async () => {
  const nextDue = [
    "2026-11-05T10:01:00.000Z",
    "2026-11-05T10:06:00.000Z",
    "2026-11-05T10:10:00.000Z",
    "2026-11-20T10:00:00.000Z",
  ];
  const { call } = fakeCall({
    count: 3,
    byKind: { vocabulary: 2, entry: 1 },
    streakDays: 1,
    recentDays: [false, false, false, false, false, true, true],
    items: [{ ...itemJson, nextDue }, itemJson],
  });
  const due = await createReviewGateway(call).listDue(20);
  assert.deepEqual(due.byKind, { vocabulary: 2, entry: 1 });
  assert.deepEqual(due.recentDays, [
    false,
    false,
    false,
    false,
    false,
    true,
    true,
  ]);
  assert.deepEqual(
    due.items[0].nextDue,
    nextDue.map((d) => new Date(d)),
  );
  assert.equal(due.items[1].nextDue, null);
});

test("an older Go without the summary still reads", async () => {
  const { call } = fakeCall({ count: 0, streakDays: 0, items: [] });
  const due = await createReviewGateway(call).listDue(20);
  assert.deepEqual(due.byKind, {});
  assert.deepEqual(due.recentDays, []);
});

test("countDue and entriesInReview read their own routes", async () => {
  const count = fakeCall({ count: 4 });
  assert.equal(await createReviewGateway(count.call).countDue(), 4);
  assert.deepEqual(count.calls, [
    { path: "/v1/reviews/count", method: "GET", body: undefined },
  ]);
  const entries = fakeCall({ entryIds: ["c1", "c2"] });
  const ids = await createReviewGateway(entries.call).entriesInReview();
  assert.deepEqual([...ids], ["c1", "c2"]);
  assert.deepEqual(entries.calls, [
    { path: "/v1/reviews/entries", method: "GET", body: undefined },
  ]);
});
