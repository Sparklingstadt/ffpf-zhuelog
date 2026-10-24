import assert from "node:assert/strict";
import { test } from "node:test";

import { readChatStream } from "../src/presentation/components/chat/chat-stream";

function streamOf(...chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

test("readChatStream joins lines split across chunks", async () => {
  const deltas: string[] = [];
  const result = await readChatStream(
    streamOf(
      '{"type":"del',
      'ta","text":"你"}\n{"type":"delta","text":"好"}\n{"type":"do',
      'ne"}\n',
    ),
    (text) => deltas.push(text),
  );
  assert.equal(result, "done");
  assert.deepEqual(deltas, ["你", "好"]);
});

test("readChatStream keeps a character split across chunks", async () => {
  const bytes = new TextEncoder().encode(
    '{"type":"delta","text":"你"}\n{"type":"done"}\n',
  );
  const split = bytes.indexOf(0xe4) + 1; // inside the 3 bytes of 你
  const deltas: string[] = [];
  const result = await readChatStream(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    }),
    (text) => deltas.push(text),
  );
  assert.equal(result, "done");
  assert.deepEqual(deltas, ["你"]);
});

test("readChatStream reports cut without done", async () => {
  const deltas: string[] = [];
  const result = await readChatStream(
    streamOf('{"type":"delta","text":"你"}\n'),
    (text) => deltas.push(text),
  );
  assert.equal(result, "cut");
  assert.deepEqual(deltas, ["你"]);
});

test("readChatStream returns the error line's message", async () => {
  const result = await readChatStream(
    streamOf(
      '{"type":"delta","text":"你"}\n{"type":"error","message":"ChatGPTから応答を受信できませんでした。"}\n',
    ),
    () => {},
  );
  assert.deepEqual(result, {
    error: "ChatGPTから応答を受信できませんでした。",
  });
});

test("readChatStream treats a broken line as cut", async () => {
  const result = await readChatStream(streamOf("not json\n"), () => {});
  assert.equal(result, "cut");
});
