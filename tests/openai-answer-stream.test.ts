import assert from "node:assert/strict";
import { test } from "node:test";

import type { OpenAiUsage } from "../src/domain/vocabulary/vocabulary-entry";
import {
  type AnswerRequest,
  streamAnswer,
} from "../src/infrastructure/openai/answer-stream";
import { CHAT_INSTRUCTIONS } from "../src/infrastructure/openai/chat";
import { QUICK_QUESTION_INSTRUCTIONS } from "../src/infrastructure/openai/quick-question";
import { OpenAiError } from "../src/infrastructure/openai/responses";

const config = {
  apiKey: "sk-test",
  baseUrl: "http://127.0.0.1:1/",
  learningModel: "gpt-5-mini",
  chatModel: "gpt-6.1-sol",
};

function quick(text = "了？", requireComplete = true): AnswerRequest {
  return {
    model: config.chatModel,
    instructions: QUICK_QUESTION_INSTRUCTIONS,
    messages: [{ role: "user", text }],
    requireComplete,
  };
}

// One server-sent event the way the Responses API writes it.
function sse(payload: object): string {
  const { type } = payload as { type: string };
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

const delta = (text: string) =>
  sse({ type: "response.output_text.delta", delta: text });
const usage = { input_tokens: 120, output_tokens: 45 };
const completed = (withUsage = false) =>
  sse({
    type: "response.completed",
    response: withUsage
      ? { status: "completed", usage }
      : { status: "completed" },
  });

// A fake fetch answering with the given status and events. Like the real
// fetch, aborting the request's signal errors the body.
function serve(
  events: string[],
  status = 200,
  seen?: (url: string, init: RequestInit) => void,
  keepOpen = false,
): typeof fetch {
  return async (url, init) => {
    seen?.(String(url), init ?? {});
    const signal = init?.signal ?? undefined;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(encoder.encode(event));
        if (!keepOpen) controller.close();
        signal?.addEventListener("abort", () => {
          try {
            controller.error(signal.reason);
          } catch {
            // already closed
          }
        });
      },
    });
    return new Response(body, { status });
  };
}

async function collect(
  stream: AsyncGenerator<string>,
): Promise<{ pieces: string[]; code?: string; message?: string }> {
  const pieces: string[] = [];
  try {
    for await (const piece of stream) pieces.push(piece);
  } catch (error) {
    assert.ok(error instanceof OpenAiError, String(error));
    return { pieces, code: error.code, message: error.message };
  }
  return { pieces };
}

function options(
  fetchImpl: typeof fetch,
  extra: {
    signal?: AbortSignal;
    onUsage?: (usage: OpenAiUsage) => void;
    timeoutMs?: number;
  } = {},
) {
  return {
    signal: extra.signal ?? new AbortController().signal,
    onUsage: extra.onUsage ?? (() => {}),
    fetchImpl,
    timeoutMs: extra.timeoutMs,
  };
}

test("QUICK_QUESTION_INSTRUCTIONS is pinned byte for byte", () => {
  // The instructions are repeated here: a change to either side must be
  // deliberate.
  const pinnedPrompt =
    "あなたは中国語学習アプリ「学习録」の質問アシスタントです。\n" +
    "中国語学習についての1回だけの質問に、まず要点から簡潔に答えてください。\n" +
    "- ユーザーが使った言語に合わせて答える。\n" +
    "- 必要に応じて中国語の例文、ピンイン、自然な日本語訳、短い理由を添える。\n" +
    "- 会話の続きや追加の練習を促す質問で締めくくらない。\n" +
    "- 不明点があれば前提を示し、確信がない内容は断定しない。";
  assert.equal(QUICK_QUESTION_INSTRUCTIONS, pinnedPrompt);
});

test("the quick question request carries the model, the instructions and store false", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fetchImpl = serve([completed()], 200, (url, init) => {
    seen = { url, init };
  });
  await collect(streamAnswer(config, quick(" 了？ "), options(fetchImpl)));
  assert.ok(seen);
  assert.equal(seen.url, "http://127.0.0.1:1/v1/responses");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.redirect, "manual");
  const headers = new Headers(seen.init.headers);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("accept"), "text/event-stream");
  assert.equal(headers.get("authorization"), "Bearer sk-test");
  assert.deepEqual(JSON.parse(String(seen.init.body)), {
    model: "gpt-6.1-sol",
    instructions: QUICK_QUESTION_INSTRUCTIONS,
    // The text goes as it is, not trimmed.
    input: [{ role: "user", content: " 了？ " }],
    stream: true,
    store: false,
    max_output_tokens: 1600,
    reasoning: { effort: "medium" },
  });
});

test("the chat request carries the model, the instructions and store false", async () => {
  // The instructions are repeated here: a change to either side must be
  // deliberate.
  const pinnedPrompt =
    "あなたは中国語学習アプリ「学习録」の会話パートナーです。\n" +
    "ユーザーの中国語学習を支援してください。\n" +
    "- 原則として、ユーザーが使った言語に合わせて答える。\n" +
    "- 中国語の例文には、必要に応じてピンインと自然な日本語訳を添える。\n" +
    "- 間違いを直すときは、自然な修正文と短い理由を示す。\n" +
    "- 会話練習では細かい訂正で流れを止めすぎず、会話を続けてから要点を整理する。\n" +
    "- 確信がない内容を断定しない。\n" +
    "- 回答は学習しやすい長さにまとめる。";
  assert.equal(CHAT_INSTRUCTIONS, pinnedPrompt);

  let body: unknown;
  const fetchImpl = serve(
    [
      delta("不客气"),
      sse({ type: "response.incomplete", response: { status: "incomplete" } }),
    ],
    200,
    (_url, init) => {
      body = JSON.parse(String(init.body));
    },
  );
  const request: AnswerRequest = {
    model: config.chatModel,
    instructions: CHAT_INSTRUCTIONS,
    messages: [
      { role: "user", text: "你好" },
      { role: "assistant", text: "你好！" },
      { role: "user", text: "谢谢" },
    ],
    requireComplete: false,
  };
  // An answer cut at the token limit ends the chat answer without an error.
  assert.deepEqual(
    await collect(streamAnswer(config, request, options(fetchImpl))),
    { pieces: ["不客气"] },
  );
  assert.deepEqual(body, {
    model: "gpt-6.1-sol",
    instructions: CHAT_INSTRUCTIONS,
    input: [
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好！" },
      { role: "user", content: "谢谢" },
    ],
    stream: true,
    store: false,
    max_output_tokens: 1600,
    reasoning: { effort: "medium" },
  });
});

test("only text deltas are yielded", async () => {
  const fetchImpl = serve([
    sse({ type: "response.created", response: { status: "in_progress" } }),
    sse({ type: "response.output_item.added" }),
    delta("你"),
    delta(""),
    delta("好"),
    sse({ type: "response.output_text.done", text: "你好" }),
    completed(),
  ]);
  assert.deepEqual(
    await collect(streamAnswer(config, quick(), options(fetchImpl))),
    { pieces: ["你", "好"] },
  );
});

test("incomplete is an error only when the answer must be complete", async () => {
  const events = [
    delta("途中"),
    sse({ type: "response.incomplete", response: { status: "incomplete" } }),
  ];
  assert.deepEqual(
    await collect(streamAnswer(config, quick(), options(serve(events)))),
    {
      pieces: ["途中"],
      code: "OPENAI_INCOMPLETE_RESPONSE",
      message: "OPENAI_INCOMPLETE_RESPONSE",
    },
  );
  assert.deepEqual(
    await collect(
      streamAnswer(config, quick("了？", false), options(serve(events))),
    ),
    { pieces: ["途中"] },
  );
});

test("failed events and statuses", async () => {
  const cases: [string, number, string[], string][] = [
    [
      "error event",
      200,
      [delta("你"), sse({ type: "error", message: "boom" })],
      "OPENAI_INVALID_RESPONSE",
    ],
    [
      "failed",
      200,
      [sse({ type: "response.failed", response: { status: "failed" } })],
      "OPENAI_INVALID_RESPONSE",
    ],
    ["no completed", 200, [delta("你")], "OPENAI_INVALID_RESPONSE"],
    ["401", 401, [], "OPENAI_AUTH_FAILED"],
    ["403", 403, [], "OPENAI_AUTH_FAILED"],
    ["429", 429, [], "OPENAI_RATE_LIMITED"],
    ["500", 500, [], "OPENAI_REQUEST_FAILED"],
    ["400", 400, [], "OPENAI_REQUEST_FAILED"],
  ];
  for (const [name, status, events, want] of cases) {
    const got = await collect(
      streamAnswer(config, quick(), options(serve(events, status))),
    );
    assert.equal(got.code, want, name);
    assert.ok(!got.message?.includes("sk-test"), `${name} leaks the key`);
  }
});

test("usage of the final event is reported once", async () => {
  const finals: [string, string][] = [
    ["completed", completed(true)],
    [
      "incomplete",
      sse({
        type: "response.incomplete",
        response: { status: "incomplete", usage },
      }),
    ],
    [
      "failed",
      sse({ type: "response.failed", response: { status: "failed", usage } }),
    ],
  ];
  for (const [name, final] of finals) {
    const reported: OpenAiUsage[] = [];
    await collect(
      streamAnswer(
        config,
        quick(),
        options(serve([delta("你"), final]), {
          onUsage: (u) => reported.push(u),
        }),
      ),
    );
    assert.deepEqual(
      reported,
      [{ model: "gpt-6.1-sol", inputTokens: 120, outputTokens: 45 }],
      name,
    );
  }
  const none: OpenAiUsage[] = [];
  await collect(
    streamAnswer(
      config,
      quick(),
      options(serve([delta("你"), completed()]), {
        onUsage: (u) => none.push(u),
      }),
    ),
  );
  assert.deepEqual(none, []);
});

test("an onUsage that throws never changes the answer", async () => {
  const result = await collect(
    streamAnswer(
      config,
      quick(),
      options(serve([delta("你"), completed(true)]), {
        onUsage: () => {
          throw new Error("bookkeeping failed");
        },
      }),
    ),
  );
  assert.deepEqual(result, { pieces: ["你"] });
});

test("stopping the iteration or the signal aborts the request", async () => {
  let requestSignal: AbortSignal | undefined;
  const open = serve(
    [delta("你"), delta("好")],
    200,
    (_url, init) => {
      requestSignal = init.signal ?? undefined;
    },
    true,
  );
  const stream = streamAnswer(config, quick(), options(open));
  assert.deepEqual(await stream.next(), { value: "你", done: false });
  await stream.return(undefined);
  assert.equal(requestSignal?.aborted, true);

  const outer = new AbortController();
  const stopped = streamAnswer(
    config,
    quick(),
    options(serve([delta("你")], 200, undefined, true), {
      signal: outer.signal,
    }),
  );
  const pieces: string[] = [];
  let code: string | undefined;
  try {
    for await (const piece of stopped) {
      pieces.push(piece);
      outer.abort();
    }
  } catch (error) {
    assert.ok(error instanceof OpenAiError);
    code = error.code;
  }
  assert.deepEqual(pieces, ["你"]);
  assert.equal(code, "OPENAI_REQUEST_FAILED");
});

test("an outer signal stopped before the request is a failed request", async () => {
  const outer = new AbortController();
  outer.abort();
  const fetchImpl: typeof fetch = async (_url, init) => {
    init?.signal?.throwIfAborted();
    return new Response("");
  };
  const got = await collect(
    streamAnswer(config, quick(), options(fetchImpl, { signal: outer.signal })),
  );
  assert.equal(got.code, "OPENAI_REQUEST_FAILED");
});

test("the whole answer times out", async () => {
  const got = await collect(
    streamAnswer(
      config,
      quick(),
      options(serve([delta("你")], 200, undefined, true), { timeoutMs: 20 }),
    ),
  );
  assert.deepEqual(got.pieces, ["你"]);
  assert.equal(got.code, "OPENAI_TIMEOUT");
});

test("a request that cannot be sent is a failed request", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const got = await collect(streamAnswer(config, quick(), options(fetchImpl)));
  assert.equal(got.code, "OPENAI_REQUEST_FAILED");
});
