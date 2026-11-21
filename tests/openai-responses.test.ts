import assert from "node:assert/strict";
import { test } from "node:test";

import type { OpenAiUsage } from "../src/domain/vocabulary/vocabulary-entry";
import {
  OpenAiError,
  respondJson,
} from "../src/infrastructure/openai/responses";

const config = {
  apiKey: "sk-test",
  baseUrl: "http://127.0.0.1:3109/",
  learningModel: "gpt-5-mini",
  chatModel: "gpt-6.1-sol",
};
const request = {
  instructions: "do it",
  schemaName: "thing",
  schema: { type: "object" },
  input: "hello",
};

function completed(texts: string[], usage?: object) {
  return {
    status: "completed",
    output: [
      {
        type: "message",
        content: texts.map((text) => ({ type: "output_text", text })),
      },
    ],
    usage,
  };
}

function json(body: unknown, status = 200): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof OpenAiError);
    return error.code;
  }
  assert.fail("expected OpenAiError");
}

test("posts the Responses request Go sends", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fetchImpl: typeof fetch = async (url, init) => {
    seen = { url: String(url), init: init ?? {} };
    return new Response(JSON.stringify(completed(["{}"])));
  };
  await respondJson(config, request, () => {}, fetchImpl);
  assert.ok(seen);
  assert.equal(seen.url, "http://127.0.0.1:3109/v1/responses");
  assert.equal(seen.init.method, "POST");
  const headers = new Headers(seen.init.headers);
  assert.equal(headers.get("authorization"), "Bearer sk-test");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(seen.init.redirect, "manual");
  assert.deepEqual(JSON.parse(String(seen.init.body)), {
    model: "gpt-5-mini",
    instructions: "do it",
    input: "hello",
    store: false,
    max_output_tokens: 4000,
    reasoning: { effort: "minimal" },
    text: {
      format: {
        type: "json_schema",
        name: "thing",
        strict: true,
        schema: { type: "object" },
      },
    },
  });
});

test("joins output_text parts of a completed response", async () => {
  const out = await respondJson(
    config,
    request,
    () => {},
    json(completed(['{"a":', "1}"])),
  );
  assert.equal(out, '{"a":1}');
});

test("reports usage even when the answer is unusable", async () => {
  const usages: OpenAiUsage[] = [];
  const body = {
    status: "incomplete",
    output: [],
    usage: { input_tokens: 12, output_tokens: 34 },
  };
  const code = await codeOf(
    respondJson(config, request, (u) => usages.push(u), json(body)),
  );
  assert.equal(code, "OPENAI_INVALID_RESPONSE");
  assert.deepEqual(usages, [
    { model: "gpt-5-mini", inputTokens: 12, outputTokens: 34 },
  ]);
});

test("a refusal is invalid", async () => {
  const body = {
    status: "completed",
    output: [
      { type: "message", content: [{ type: "refusal", refusal: "no" }] },
    ],
  };
  assert.equal(
    await codeOf(respondJson(config, request, () => {}, json(body))),
    "OPENAI_INVALID_RESPONSE",
  );
});

test("maps HTTP errors", async () => {
  const status = (s: number) =>
    codeOf(respondJson(config, request, () => {}, json({}, s)));
  assert.equal(await status(401), "OPENAI_AUTH_FAILED");
  assert.equal(await status(403), "OPENAI_AUTH_FAILED");
  assert.equal(await status(429), "OPENAI_RATE_LIMITED");
  assert.equal(await status(500), "OPENAI_REQUEST_FAILED");
  const failing =
    (error: Error): typeof fetch =>
    async () => {
      throw error;
    };
  assert.equal(
    await codeOf(
      respondJson(
        config,
        request,
        () => {},
        failing(new TypeError("fetch failed")),
      ),
    ),
    "OPENAI_REQUEST_FAILED",
  );
  assert.equal(
    await codeOf(
      respondJson(
        config,
        request,
        () => {},
        failing(new DOMException("x", "AbortError")),
      ),
    ),
    "OPENAI_TIMEOUT",
  );
  assert.equal(
    await codeOf(
      respondJson(
        config,
        request,
        () => {},
        failing(new DOMException("x", "TimeoutError")),
      ),
    ),
    "OPENAI_TIMEOUT",
  );
});

test("a body over 1 MiB is invalid", async () => {
  const big = async () => new Response("x".repeat(1024 * 1024 + 1));
  assert.equal(
    await codeOf(respondJson(config, request, () => {}, big)),
    "OPENAI_INVALID_RESPONSE",
  );
});

test("does not follow redirects", async () => {
  let redirect: RequestRedirect | undefined;
  const fetchImpl: typeof fetch = async (_url, init) => {
    redirect = init?.redirect;
    return new Response(null, {
      status: 302,
      headers: { location: "https://evil.example" },
    });
  };
  assert.equal(
    await codeOf(respondJson(config, request, () => {}, fetchImpl)),
    "OPENAI_REQUEST_FAILED",
  );
  assert.equal(redirect, "manual");
});
