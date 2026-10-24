import assert from "node:assert/strict";
import { test } from "node:test";

import type { GoApiCall } from "../src/infrastructure/go-api/authed";
import { GoApiError } from "../src/infrastructure/go-api/client";
import { createPrepositionRecordGateway } from "../src/infrastructure/go-api/preposition-record-gateway";

function fakeCall(response: unknown) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const call = (async (
    path: string,
    init: { method: string; body?: unknown },
  ) => {
    calls.push({ path, method: init.method, body: init.body });
    if (response instanceof Error) throw response;
    return response;
  }) as GoApiCall;
  return { call, calls };
}

const summaryJson = {
  id: "0b0c6f4e-5d2a-4c1b-9e3f-7a8b9c0d1e2f",
  questionCount: 25,
  firstTryCount: 20,
  missCount: 7,
  elapsedMs: 95_000,
  startedAt: "2026-10-24T01:00:00.000Z",
  createdAt: "2026-10-24T01:01:35.000Z",
};
const questions = [
  { answer: "在", noun: "学校", prompt: "（　）学校学习", misses: ["把"] },
];

test("list maps Go JSON to dates", async () => {
  const { call, calls } = fakeCall({ records: [summaryJson] });
  const records = await createPrepositionRecordGateway(call).list();
  assert.deepEqual(calls, [
    { path: "/v1/preposition-records", method: "GET", body: undefined },
  ]);
  assert.deepEqual(records, [
    {
      ...summaryJson,
      startedAt: new Date(summaryJson.startedAt),
      createdAt: new Date(summaryJson.createdAt),
    },
  ]);
});

test("get returns null on 404, encodes the id and rethrows other errors", async () => {
  const missing = fakeCall(new GoApiError(404, "not_found"));
  assert.equal(
    await createPrepositionRecordGateway(missing.call).get("a/b"),
    null,
  );
  assert.equal(missing.calls[0].path, "/v1/preposition-records/a%2Fb");

  const found = fakeCall({ ...summaryJson, questions });
  const record = await createPrepositionRecordGateway(found.call).get(
    summaryJson.id,
  );
  assert.deepEqual(record?.questions, questions);
  assert.deepEqual(record?.createdAt, new Date(summaryJson.createdAt));

  const failing = fakeCall(new GoApiError(503, "unavailable"));
  await assert.rejects(
    createPrepositionRecordGateway(failing.call).get("x"),
    GoApiError,
  );
});

test("save PUTs the round under its id", async () => {
  const { call, calls } = fakeCall({ ...summaryJson, questions });
  const saved = await createPrepositionRecordGateway(call).save({
    id: summaryJson.id,
    startedAt: new Date(summaryJson.startedAt),
    elapsedMs: 95_000,
    questions,
  });
  assert.deepEqual(calls, [
    {
      path: `/v1/preposition-records/${summaryJson.id}`,
      method: "PUT",
      body: {
        startedAt: summaryJson.startedAt,
        elapsedMs: 95_000,
        questions,
      },
    },
  ]);
  assert.equal(saved.missCount, 7);
});
