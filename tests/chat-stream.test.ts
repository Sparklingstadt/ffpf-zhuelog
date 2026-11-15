import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readChatStream,
  readFailureText,
  streamChat,
} from "../src/presentation/components/chat/chat-stream";

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

test("readFailureText reads the relay's string error", async () => {
  const response = Response.json(
    { error: "上限に達しました。" },
    { status: 429 },
  );
  assert.equal(
    await readFailureText(response, "fallback"),
    "上限に達しました。",
  );
});

test("readFailureText reads Go's error message", async () => {
  const response = Response.json(
    { error: { code: "RATE_LIMITED", message: "少し待ってください。" } },
    { status: 429 },
  );
  assert.equal(
    await readFailureText(response, "fallback"),
    "少し待ってください。",
  );
});

test("readFailureText falls back when the body is not usable", async () => {
  assert.equal(
    await readFailureText(new Response("oops", { status: 502 }), "fallback"),
    "fallback",
  );
  assert.equal(
    await readFailureText(
      Response.json({ error: "" }, { status: 500 }),
      "fallback",
    ),
    "fallback",
  );
});

const texts = { failure: "F", cut: "C", stopped: "S" };

function fetchReturning(response: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (response instanceof Error) throw response;
    return response;
  };
  return { fetchFn, calls };
}

test("streamChat posts the messages and returns the whole answer", async () => {
  const { fetchFn, calls } = fetchReturning(
    new Response(
      streamOf(
        '{"type":"delta","text":"你"}\n{"type":"delta","text":"好"}\n{"type":"done"}\n',
      ),
    ),
  );
  const deltas: string[] = [];
  const result = await streamChat({
    endpoint: "/api/chat",
    messages: [{ role: "user", text: "hi" }],
    signal: new AbortController().signal,
    onText: (text) => deltas.push(text),
    texts,
    fetchFn,
  });
  assert.deepEqual(result, { ok: true, text: "你好" });
  assert.deepEqual(deltas, ["你", "你好"]);
  assert.equal(calls[0]!.url, "/api/chat");
  assert.equal(
    calls[0]!.init.body,
    JSON.stringify({ messages: [{ role: "user", text: "hi" }] }),
  );
});

test("streamChat gives the server's reason for a refused request", async () => {
  const { fetchFn } = fetchReturning(
    Response.json({ error: "上限です。" }, { status: 429 }),
  );
  const result = await streamChat({
    endpoint: "/api/chat",
    messages: [],
    signal: new AbortController().signal,
    onText: () => {},
    texts,
    fetchFn,
  });
  assert.deepEqual(result, { ok: false, text: "", message: "上限です。" });
});

test("streamChat keeps what arrived of a cut answer", async () => {
  const { fetchFn } = fetchReturning(
    new Response(streamOf('{"type":"delta","text":"半"}\n')),
  );
  const result = await streamChat({
    endpoint: "/api/chat",
    messages: [],
    signal: new AbortController().signal,
    onText: () => {},
    texts,
    fetchFn,
  });
  assert.deepEqual(result, { ok: false, text: "半", message: "C" });
});

test("streamChat passes on an error the stream reports", async () => {
  const { fetchFn } = fetchReturning(
    new Response(streamOf('{"type":"error","message":"途中で失敗"}\n')),
  );
  const result = await streamChat({
    endpoint: "/api/chat",
    messages: [],
    signal: new AbortController().signal,
    onText: () => {},
    texts,
    fetchFn,
  });
  assert.deepEqual(result, { ok: false, text: "", message: "途中で失敗" });
});

test("streamChat tells a stop from a network failure", async () => {
  const stopped = new AbortController();
  stopped.abort();
  const { fetchFn } = fetchReturning(new Error("aborted"));
  assert.deepEqual(
    await streamChat({
      endpoint: "/api/chat",
      messages: [],
      signal: stopped.signal,
      onText: () => {},
      texts,
      fetchFn,
    }),
    { ok: false, text: "", message: "S" },
  );
  assert.deepEqual(
    await streamChat({
      endpoint: "/api/chat",
      messages: [],
      signal: new AbortController().signal,
      onText: () => {},
      texts,
      fetchFn,
    }),
    { ok: false, text: "", message: "F" },
  );
});
