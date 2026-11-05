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
