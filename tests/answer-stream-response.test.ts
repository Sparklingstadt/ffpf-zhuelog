import assert from "node:assert/strict";
import { test } from "node:test";

import { answerStreamResponse } from "../src/presentation/http/answer-stream-response";

const FAILURE = "ChatGPTから応答を受信できませんでした。";

async function* pieces(...texts: string[]): AsyncGenerator<string> {
  for (const text of texts) yield text;
}

test("pieces become delta lines and done", async () => {
  const response = await answerStreamResponse(pieces("你", "好"));
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/x-ndjson; charset=utf-8",
  );
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    await response.text(),
    '{"type":"delta","text":"你"}\n{"type":"delta","text":"好"}\n{"type":"done"}\n',
  );
});

test("a failure before the first piece is a 502 and after it an error line", async () => {
  const before = await answerStreamResponse(
    (async function* (): AsyncGenerator<string> {
      throw new Error("OPENAI_AUTH_FAILED");
    })(),
  );
  assert.equal(before.status, 502);
  assert.equal(before.headers.get("cache-control"), "no-store");
  assert.deepEqual(await before.json(), {
    error: { code: "chat_failed", message: FAILURE },
  });

  const after = await answerStreamResponse(
    (async function* (): AsyncGenerator<string> {
      yield "你";
      throw new Error("OPENAI_INCOMPLETE_RESPONSE");
    })(),
  );
  assert.equal(after.status, 200);
  const lines = (await after.text()).trimEnd().split("\n");
  assert.deepEqual(lines, [
    '{"type":"delta","text":"你"}',
    `{"type":"error","message":"${FAILURE}"}`,
  ]);
});

test("an answer without pieces is only done", async () => {
  const response = await answerStreamResponse(pieces());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"type":"done"}\n');
});

test("cancelling the response returns the iterator", async () => {
  let finished = false;
  let resumed = false;
  const response = await answerStreamResponse(
    (async function* (): AsyncGenerator<string> {
      try {
        yield "你";
        resumed = true;
        yield "好";
      } finally {
        finished = true;
      }
    })(),
  );
  assert.equal(response.status, 200);
  await response.body!.cancel();
  assert.equal(finished, true);
  assert.equal(resumed, false);
});
