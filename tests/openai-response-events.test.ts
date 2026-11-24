import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readResponseEvents,
  type ResponseEvent,
} from "../src/infrastructure/openai/response-events";
import { OpenAiError } from "../src/infrastructure/openai/responses";

function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(
          typeof chunk === "string" ? encoder.encode(chunk) : chunk,
        );
      controller.close();
    },
  });
}

function data(event: object): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function collect(
  body: ReadableStream<Uint8Array>,
  maxLineBytes?: number,
): Promise<ResponseEvent[]> {
  const events: ResponseEvent[] = [];
  for await (const event of readResponseEvents(body, maxLineBytes))
    events.push(event);
  return events;
}

const delta = (text: string) => ({
  type: "response.output_text.delta",
  delta: text,
});

test("deltas, then the final event with its usage", async () => {
  const events = await collect(
    streamOf([
      "event: response.created\n",
      data({ type: "response.created", response: {} }),
      ": keep-alive\n\n",
      "event: response.output_text.delta\n",
      data(delta("你")),
      data(delta("")),
      data(delta("好")),
      data({
        type: "response.completed",
        response: { usage: { input_tokens: 120, output_tokens: 45 } },
      }),
      data(delta("after")),
    ]),
  );
  assert.deepEqual(events, [
    { type: "delta", text: "你" },
    { type: "delta", text: "好" },
    {
      type: "end",
      outcome: "completed",
      usage: { inputTokens: 120, outputTokens: 45 },
    },
  ]);

  assert.deepEqual(
    await collect(
      streamOf([data({ type: "response.completed", response: {} })]),
    ),
    [{ type: "end", outcome: "completed" }],
  );
  assert.deepEqual(
    await collect(streamOf([data({ type: "response.completed" })])),
    [{ type: "end", outcome: "completed" }],
  );
  assert.deepEqual(
    await collect(
      streamOf([
        data({
          type: "response.completed",
          response: { usage: { input_tokens: -3, output_tokens: 7 } },
        }),
      ]),
    ),
    [
      {
        type: "end",
        outcome: "completed",
        usage: { inputTokens: 0, outputTokens: 7 },
      },
    ],
  );
});

test("incomplete, failed and error end the stream", async () => {
  const usage = { input_tokens: 5, output_tokens: 6 };
  for (const [type, outcome] of [
    ["response.incomplete", "incomplete"],
    ["response.failed", "failed"],
    ["error", "failed"],
  ] as const) {
    assert.deepEqual(
      await collect(
        streamOf([
          data(delta("一")),
          data({ type, response: { usage } }),
          data(delta("never")),
        ]),
      ),
      [
        { type: "delta", text: "一" },
        {
          type: "end",
          outcome,
          usage: { inputTokens: 5, outputTokens: 6 },
        },
      ],
      type,
    );
  }
  assert.deepEqual(
    await collect(streamOf([data({ type: "error", message: "boom" })])),
    [{ type: "end", outcome: "failed" }],
  );
});

test("a line split across chunks and CRLF line ends are read whole", async () => {
  const bytes = new TextEncoder().encode(
    `data: ${JSON.stringify(delta("汉字"))}\r\n\r\n`,
  );
  // Split inside the three bytes of "汉".
  const at = bytes.indexOf(0xe6) + 1;
  const events = await collect(
    streamOf([
      bytes.slice(0, 4),
      bytes.slice(4, at),
      bytes.slice(at),
      'data: {"type":"response.completed"}\r\n',
    ]),
  );
  assert.deepEqual(events, [
    { type: "delta", text: "汉字" },
    { type: "end", outcome: "completed" },
  ]);
});

test("bad JSON and an over-long line are OPENAI_INVALID_RESPONSE", async () => {
  const invalid = (error: unknown) =>
    error instanceof OpenAiError && error.code === "OPENAI_INVALID_RESPONSE";

  await assert.rejects(collect(streamOf(["data: {nope\n\n"])), invalid);
  await assert.rejects(collect(streamOf(["data: [DONE]\n\n"])), invalid);
  await assert.rejects(collect(streamOf(["data: 5\n\n"])), invalid);

  const line = `data: ${JSON.stringify(delta("长".repeat(10)))}`;
  const bytes = Buffer.byteLength(line);
  assert.deepEqual(await collect(streamOf([`${line}\n`]), bytes), [
    { type: "delta", text: "长".repeat(10) },
  ]);
  await assert.rejects(collect(streamOf([`${line}\n`]), bytes - 1), invalid);
  // A long line with no line end yet is refused too.
  await assert.rejects(
    collect(streamOf([`: ${"x".repeat(100)}`]), 50),
    invalid,
  );
});

test("a stream that ends without a final event ends the generator", async () => {
  assert.deepEqual(
    await collect(streamOf([data(delta("半")), "event: response.completed"])),
    [{ type: "delta", text: "半" }],
  );
  // A last line without a line end is still read.
  assert.deepEqual(
    await collect(streamOf([`data: ${JSON.stringify(delta("尾"))}`])),
    [{ type: "delta", text: "尾" }],
  );
});

test("read errors are rethrown as they are", async () => {
  const failure = new Error("socket closed");
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(failure);
    },
  });
  await assert.rejects(collect(body), (error) => error === failure);
});
