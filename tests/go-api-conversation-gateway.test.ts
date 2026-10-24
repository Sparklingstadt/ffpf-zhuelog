import assert from "node:assert/strict";
import { test } from "node:test";

import type { GoApiCall } from "../src/infrastructure/go-api/authed";
import { GoApiError } from "../src/infrastructure/go-api/client";
import {
  ChatUnavailableError,
  createConversationGateway,
} from "../src/infrastructure/go-api/conversation-gateway";

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
  title: "你好",
  modelName: "gpt-test",
  ended: false,
  createdAt: "2026-10-24T01:02:03.000Z",
  updatedAt: "2026-10-24T01:05:00.000Z",
};
const messages = [
  { id: "m1", role: "user", text: "你好" },
  { id: "m2", role: "assistant", text: "你好！" },
];

test("list maps Go JSON to dates and keeps chatModel", async () => {
  const { call, calls } = fakeCall({
    chatModel: "gpt-test",
    conversations: [summaryJson],
  });
  const result = await createConversationGateway(call).list();
  assert.deepEqual(calls, [
    { path: "/v1/conversations", method: "GET", body: undefined },
  ]);
  assert.equal(result.chatModel, "gpt-test");
  assert.deepEqual(result.conversations, [
    {
      ...summaryJson,
      createdAt: new Date(summaryJson.createdAt),
      updatedAt: new Date(summaryJson.updatedAt),
    },
  ]);
});

test("list throws ChatUnavailableError on 404", async () => {
  const { call } = fakeCall(new GoApiError(404, "not_found"));
  await assert.rejects(
    createConversationGateway(call).list(),
    ChatUnavailableError,
  );
});

test("get returns null on 404 and encodes the id", async () => {
  const { call, calls } = fakeCall(new GoApiError(404, "not_found"));
  assert.equal(await createConversationGateway(call).get("a/b"), null);
  assert.equal(calls[0].path, "/v1/conversations/a%2Fb");

  const found = fakeCall({ ...summaryJson, messages });
  const conversation = await createConversationGateway(found.call).get(
    summaryJson.id,
  );
  assert.deepEqual(conversation?.messages, messages);
  assert.deepEqual(conversation?.createdAt, new Date(summaryJson.createdAt));
});

test("get rethrows other Go errors", async () => {
  const { call } = fakeCall(new GoApiError(503, "unavailable"));
  await assert.rejects(createConversationGateway(call).get("x"), GoApiError);
});

test("save PUTs the whole conversation with ISO dates", async () => {
  const { call, calls } = fakeCall({ ...summaryJson, messages });
  await createConversationGateway(call).save({
    ...summaryJson,
    createdAt: new Date(summaryJson.createdAt),
    updatedAt: new Date(0),
    messages: messages as never,
  });
  assert.deepEqual(calls, [
    {
      path: `/v1/conversations/${summaryJson.id}`,
      method: "PUT",
      body: {
        title: "你好",
        modelName: "gpt-test",
        ended: false,
        createdAt: "2026-10-24T01:02:03.000Z",
        messages,
      },
    },
  ]);
});

test("remove DELETEs", async () => {
  const { call, calls } = fakeCall(undefined);
  await createConversationGateway(call).remove(summaryJson.id);
  assert.deepEqual(calls, [
    {
      path: `/v1/conversations/${summaryJson.id}`,
      method: "DELETE",
      body: undefined,
    },
  ]);
});
