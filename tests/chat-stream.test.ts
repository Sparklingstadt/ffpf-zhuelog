import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LearningChatBusyError,
  LearningChatError,
} from "@ffpf-zhuelog/core/domain/chat/learning-chat-error";
import { handleChatRequest } from "../src/presentation/controllers/chat-controller";

const request = () =>
  new Request("https://app.example/api/chat", {
    method: "POST",
    headers: {
      Origin: "https://app.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        { id: "1", role: "user", parts: [{ type: "text", text: "你好" }] },
      ],
    }),
  });

async function* answer(...pieces: string[]) {
  for (const piece of pieces) yield piece;
}

test("chat answers stream as a UI message stream without caching", async () => {
  const response = await handleChatRequest(request(), {
    execute: () => answer("你", "好"),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.text();
  assert.match(body, /"type":"text-delta","id":"answer","delta":"你"/);
  assert.match(body, /"delta":"好"/);
  assert.match(body, /"type":"finish"/);
  assert.match(body, /\[DONE\]/);
});

test("provider failures show only messages that are safe to display", async () => {
  for (const [error, shown] of [
    [
      new LearningChatError("ChatGPTから応答を受信できませんでした。"),
      "ChatGPTから応答を受信できませんでした。",
    ],
    [new Error("sk-private-key"), "応答を取得できませんでした。"],
  ] as const) {
    const response = await handleChatRequest(request(), {
      async *execute() {
        yield "途中";
        throw error;
      },
    });
    const body = await response.text();
    assert.match(body, /途中/);
    assert.ok(body.includes(shown), body);
    assert.doesNotMatch(body, /sk-private/);
  }
});

test("a busy provider is rejected before streaming starts", async () => {
  const response = await handleChatRequest(request(), {
    execute() {
      throw new LearningChatBusyError("別の会話が応答中です。");
    },
  });
  assert.equal(response.status, 429);
  assert.match(await response.text(), /別の会話が応答中です。/);
});

test("closing the response aborts the provider", async () => {
  let signal: AbortSignal | undefined;
  const response = await handleChatRequest(request(), {
    execute(_messages, received) {
      signal = received;
      return (async function* () {
        yield "a";
        await new Promise((resolve) =>
          received?.addEventListener("abort", resolve),
        );
      })();
    },
  });
  await response.body!.cancel();
  // Cancellation travels through the SDK's stream pipeline asynchronously.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("not aborted")), 1000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    if (signal?.aborted) done();
    else signal?.addEventListener("abort", done);
  });
  assert.equal(signal?.aborted, true);
});
