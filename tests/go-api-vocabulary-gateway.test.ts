import assert from "node:assert/strict";
import { test } from "node:test";

import type { GoApiCall } from "../src/infrastructure/go-api/authed";
import { createVocabularyGateway } from "../src/infrastructure/go-api/vocabulary-gateway";

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

const id = "0b0c6f4e-5d2a-4c1b-9e3f-7a8b9c0d1e2f";
const entryJson = {
  id,
  language: "zh",
  word: "认真",
  pinyin: "rènzhēn",
  meaning: "まじめに",
  sourceEntryId: "cabcdefghijklmnopqrstuvwx",
  createdAt: "2026-11-05T12:00:00.000Z",
  updatedAt: "2026-11-05T13:00:00.000Z",
};

test("list maps dates", async () => {
  const { call, calls } = fakeCall({ entries: [entryJson] });
  const list = await createVocabularyGateway(call).list();
  assert.deepEqual(calls, [
    { path: "/v1/vocabulary", method: "GET", body: undefined },
  ]);
  assert.equal(list[0].word, "认真");
  assert.deepEqual(list[0].createdAt, new Date("2026-11-05T12:00:00.000Z"));
  assert.deepEqual(list[0].updatedAt, new Date("2026-11-05T13:00:00.000Z"));
  assert.equal(list[0].nextReview, null);
});

test("list carries when each word comes back", async () => {
  const { call } = fakeCall({
    entries: [{ ...entryJson, nextReview: "2026-11-20T00:00:00.000Z" }],
  });
  const list = await createVocabularyGateway(call).list();
  assert.deepEqual(list[0].nextReview, new Date("2026-11-20T00:00:00.000Z"));
});

test("save PUTs under the id and sends the source only when there is one", async () => {
  const { call, calls } = fakeCall(entryJson);
  const gateway = createVocabularyGateway(call);
  await gateway.save({
    id,
    word: "认真",
    pinyin: "rènzhēn",
    meaning: "まじめに",
    sourceEntryId: "cabcdefghijklmnopqrstuvwx",
  });
  await gateway.save({ id, word: "认真", pinyin: "", meaning: "まじめに" });
  assert.deepEqual(calls, [
    {
      path: `/v1/vocabulary/${id}`,
      method: "PUT",
      body: {
        word: "认真",
        pinyin: "rènzhēn",
        meaning: "まじめに",
        sourceEntryId: "cabcdefghijklmnopqrstuvwx",
      },
    },
    {
      path: `/v1/vocabulary/${id}`,
      method: "PUT",
      body: { word: "认真", pinyin: "", meaning: "まじめに" },
    },
  ]);
});

test("remove DELETEs and draft POSTs the word and sentence", async () => {
  const { call, calls } = fakeCall({ pinyin: "rènzhēn", meaning: "まじめに" });
  const gateway = createVocabularyGateway(call);
  await gateway.remove(id);
  const draft = await gateway.draft("认真", "他学习很认真。");
  assert.deepEqual(calls, [
    { path: `/v1/vocabulary/${id}`, method: "DELETE", body: undefined },
    {
      path: "/v1/vocabulary/draft",
      method: "POST",
      body: { word: "认真", sentence: "他学习很认真。" },
    },
  ]);
  assert.deepEqual(draft, { pinyin: "rènzhēn", meaning: "まじめに" });
});
