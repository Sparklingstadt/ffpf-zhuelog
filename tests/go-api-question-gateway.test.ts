import assert from "node:assert/strict";
import { test } from "node:test";
import type { GoApiCall } from "../src/infrastructure/go-api/authed";
import { GoApiError } from "../src/infrastructure/go-api/client";
import { ChatUnavailableError } from "../src/infrastructure/go-api/conversation-gateway";
import { createQuestionGateway } from "../src/infrastructure/go-api/question-gateway";

test("question gateway maps note dates and saves only the single Q&A", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const q = {
    id: "question",
    question: "了？",
    answer: "答え",
    modelName: "test",
    createdAt: "2026-10-29T00:00:00Z",
  };
  const call = (async (
    path: string,
    init: { method: string; body?: unknown },
  ) => {
    calls.push({ path, body: init.body });
    return path === "/v1/questions" ? { chatModel: "test", questions: [q] } : q;
  }) as GoApiCall;
  const gateway = createQuestionGateway(call);
  assert.equal(
    (await gateway.list()).questions[0].createdAt.toISOString(),
    "2026-10-29T00:00:00.000Z",
  );
  assert.equal((await gateway.get("question"))?.answer, "答え");
  await gateway.save({
    id: "question",
    question: q.question,
    answer: q.answer,
  });
  assert.deepEqual(calls[2], {
    path: "/v1/questions/question",
    body: { question: q.question, answer: q.answer },
  });
});
test("question gateway distinguishes unavailable routes, missing notes, and server failures", async () => {
  const missing = (async () => {
    throw new GoApiError(404, "not_found");
  }) as GoApiCall;
  await assert.rejects(
    createQuestionGateway(missing).list(),
    ChatUnavailableError,
  );
  assert.equal(await createQuestionGateway(missing).get("other"), null);
  const failed = (async () => {
    throw new GoApiError(500, "failed");
  }) as GoApiCall;
  await assert.rejects(createQuestionGateway(failed).get("other"), GoApiError);
});
