import assert from "node:assert/strict";
import { test } from "node:test";
import { TRANSLATION_INSTRUCTIONS } from "@ffpf-zhuelog/core/domain/learning/chinese-translation";
import { CORRECTION_INSTRUCTIONS } from "@ffpf-zhuelog/core/domain/learning/chinese-correction";
import { LineGenerationError } from "@ffpf-zhuelog/core/domain/line/generation-failure";
import { endpointOverride } from "../src/infrastructure/config/test-endpoint";
import { OpenAiLineLearningGenerator } from "../src/infrastructure/line/openai-line-learning-generator";
import { LinePushMessenger } from "../src/infrastructure/line/line-messenger";

const translation = {
  translatedText: "今天我很忙。",
  pinyin: "Jīntiān wǒ hěn máng.",
  hints: ["忙=忙しい"],
};
const correction = {
  correctedText: "今天我很忙。",
  pinyin: "Jīntiān wǒ hěn máng.",
  hints: ["忙=忙しい"],
};
const upstream = (value: unknown) =>
  Response.json({
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(value) }],
      },
    ],
  });
const raw = (text: string) =>
  Response.json({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
  });
const signal = () => new AbortController().signal;
// Like the real fetch: rejects once the request signal aborts (even if it
// already has) and otherwise never answers.
const hangUntilAborted: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    const abort = () => reject(new Error("SECRET"));
    if (init?.signal?.aborted) abort();
    else init?.signal?.addEventListener("abort", abort);
  });

test("translation requests use the fixed model without storage", async () => {
  let url = "";
  let init: RequestInit | undefined;
  const generator = new OpenAiLineLearningGenerator(
    "test-key",
    async (input, options) => {
      url = String(input);
      init = options;
      return upstream(translation);
    },
  );
  const result = await generator.translate("今日は忙しいです。", signal());
  assert.deepEqual(result, translation);
  assert.equal(url, "https://api.openai.com/v1/responses");
  assert.equal(init?.method, "POST");
  assert.equal(init?.redirect, "error");
  assert.equal(init?.cache, "no-store");
  assert.equal(
    (init?.headers as Record<string, string>).Authorization,
    "Bearer test-key",
  );
  const body = JSON.parse(String(init?.body));
  assert.equal(body.model, "gpt-5-mini");
  assert.equal(body.store, false);
  assert.equal(body.instructions, TRANSLATION_INSTRUCTIONS);
  assert.equal(body.input, "今日は忙しいです。");
  assert.equal(body.text.format.name, "japanese_to_chinese_translation");
});

test("correction requests use the correction schema", async () => {
  let body: {
    instructions?: string;
    input?: string;
    text?: { format: { name: string } };
  } = {};
  const generator = new OpenAiLineLearningGenerator(
    "test-key",
    async (_input, options) => {
      body = JSON.parse(String(options?.body));
      return upstream(correction);
    },
  );
  const result = await generator.correct("今天我很busy。", signal());
  assert.deepEqual(result, correction);
  assert.equal(body.instructions, CORRECTION_INSTRUCTIONS);
  assert.equal(body.input, "今天我很busy。");
  assert.equal(body.text?.format.name, "chinese_correction");
});

test("a custom base URL is used for requests", async () => {
  let url = "";
  const generator = new OpenAiLineLearningGenerator(
    "test-key",
    async (input) => {
      url = String(input);
      return upstream(translation);
    },
    "http://127.0.0.1:3108",
  );
  await generator.translate("今日は忙しいです。", signal());
  assert.equal(url, "http://127.0.0.1:3108/v1/responses");
});

test("provider failures map to failure codes", async () => {
  const failing = async (
    fetcher: typeof fetch,
    timeoutMs?: number,
    callerSignal: AbortSignal = signal(),
  ) => {
    const generator = new OpenAiLineLearningGenerator(
      "test-key",
      fetcher,
      "https://api.openai.com",
      timeoutMs,
    );
    try {
      await generator.translate("今日は忙しいです。", callerSignal);
    } catch (error) {
      assert.ok(error instanceof LineGenerationError);
      assert.equal(error.message, error.code);
      assert.ok(!error.message.includes("SECRET"));
      return error.code;
    }
    assert.fail("expected a failure");
  };
  const status = (code: number) => async () =>
    new Response("SECRET", { status: code });

  assert.equal(await failing(status(401)), "OPENAI_AUTH_FAILED");
  assert.equal(await failing(status(403)), "OPENAI_AUTH_FAILED");
  assert.equal(await failing(status(429)), "OPENAI_RATE_LIMITED");
  assert.equal(await failing(status(500)), "OPENAI_REQUEST_FAILED");
  assert.equal(await failing(hangUntilAborted, 10), "OPENAI_TIMEOUT");
  const callerAbort = new AbortController();
  callerAbort.abort();
  assert.equal(
    await failing(hangUntilAborted, undefined, callerAbort.signal),
    "OPENAI_TIMEOUT",
  );
  assert.equal(
    await failing(async () =>
      Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "SECRET" }],
          },
        ],
      }),
    ),
    "OPENAI_INVALID_RESPONSE",
  );
  assert.equal(
    await failing(async () => raw("SECRET not json")),
    "OPENAI_INVALID_RESPONSE",
  );
  assert.equal(
    await failing(async () => new Response("SECRET not json")),
    "OPENAI_INVALID_RESPONSE",
  );
  assert.equal(
    await failing(async () =>
      upstream({ ...translation, translatedText: " " }),
    ),
    "OPENAI_INVALID_RESPONSE",
  );
});

test("test endpoints accept only loopback hosts", () => {
  const fallback = "https://api.openai.com";
  assert.equal(
    endpointOverride("http://127.0.0.1:3108", fallback),
    "http://127.0.0.1:3108",
  );
  assert.equal(
    endpointOverride("http://localhost:3108/", fallback),
    "http://localhost:3108",
  );
  assert.equal(
    endpointOverride("https://[::1]:3108", fallback),
    "https://[::1]:3108",
  );
  assert.equal(endpointOverride(undefined, fallback), fallback);
  assert.equal(endpointOverride("", fallback), fallback);
  for (const value of [
    "https://api.openai.com.evil.test",
    "http://10.0.0.1",
    "file:///etc",
    "http://127.0.0.1.evil.test",
    "http://127.0.0.1:3108/path",
    "http://user@127.0.0.1",
  ])
    assert.throws(() => endpointOverride(value, fallback), {
      message: "INVALID_TEST_ENDPOINT",
    });
});

test("LINE pushes go to the configured endpoint", async () => {
  let url = "";
  const messenger = new LinePushMessenger(
    "secret",
    async (input) => {
      url = String(input);
      return new Response("{}");
    },
    "http://127.0.0.1:3109",
  );
  assert.equal(await messenger.pushText("U1", "hello", "key"), "accepted");
  assert.equal(url, "http://127.0.0.1:3109/v2/bot/message/push");
});
