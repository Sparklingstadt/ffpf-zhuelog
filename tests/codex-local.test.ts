import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { runCodexLocalTurn } from "../src/infrastructure/chat/codex-local-client";
import {
  isCodexLocalEnabled,
  isLocalChatRequest,
} from "../src/infrastructure/chat/codex-local-policy";
import { CodexLocalLearningChatGateway } from "../src/infrastructure/chat/codex-local-learning-chat-gateway";

function setup(t: TestContext) {
  const original = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: "development",
    CHAT_PROVIDER: "codex-local",
    CODEX_LOCAL_BIN: resolve("tests/fixtures/codex-app-server.mjs"),
    OPENAI_API_KEY: "must-not-leak",
    DATABASE_URL: "must-not-leak",
    CODEX_ACCESS_TOKEN: "must-not-leak",
  });
  delete process.env.VERCEL;
  t.after(() => {
    process.env = original;
  });
}

function request(origin = "http://localhost:3000", extra = {}) {
  return new Request("http://localhost:3000/api/chat", {
    headers: { host: "localhost:3000", origin, ...extra },
  });
}

test("local provider is opt-in, development-only, never Vercel", (t) => {
  setup(t);
  assert.ok(isCodexLocalEnabled());
  process.env.VERCEL = "1";
  assert.equal(isCodexLocalEnabled(), false);
  delete process.env.VERCEL;
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal(isCodexLocalEnabled(), false);
  Object.assign(process.env, {
    NODE_ENV: "development",
    CHAT_PROVIDER: "openai",
  });
  assert.equal(isCodexLocalEnabled(), false);
});

test("requires matching loopback host and same origin", (t) => {
  setup(t);
  assert.ok(isLocalChatRequest(request()));
  assert.ok(
    isLocalChatRequest(
      request(undefined, { "x-forwarded-host": "localhost:3000" }),
    ),
  );
  assert.equal(
    isLocalChatRequest(
      request(undefined, { "x-forwarded-host": "evil.example" }),
    ),
    false,
  );
  assert.equal(isLocalChatRequest(request("https://evil.example")), false);
  assert.equal(isLocalChatRequest(request("null")), false);
  assert.equal(
    isLocalChatRequest(request(undefined, { host: "evil.example" })),
    false,
  );
  assert.equal(
    isLocalChatRequest(request(undefined, { "sec-fetch-site": "cross-site" })),
    false,
  );
  assert.equal(
    isLocalChatRequest(request(undefined, { forwarded: "host=evil.example" })),
    false,
  );
  assert.equal(
    isLocalChatRequest(
      new Request("https://example.com/api/chat", {
        headers: { host: "example.com", origin: "https://example.com" },
      }),
    ),
    false,
  );
});

test("streams exact-model text, disables inherited MCP, strips app credentials", async (t) => {
  setup(t);
  let output = "";
  await runCodexLocalTurn({
    instructions: "test",
    text: "hello",
    onDelta: (text) => {
      output += text;
    },
  });
  assert.equal(output, "你好（nǐ hǎo）");
});

for (const scenario of ["tool", "failure", "exit", "long"]) {
  test(`fails closed on ${scenario}`, async (t) => {
    setup(t);
    await assert.rejects(
      runCodexLocalTurn({
        instructions: "test",
        text: scenario,
        onDelta: () => {},
      }),
    );
  });
}

test("abort stops an active child and pre-abort starts none", async (t) => {
  setup(t);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 300);
  try {
    await assert.rejects(
      runCodexLocalTurn({
        instructions: "test",
        text: "hang",
        signal: abort.signal,
        onDelta: () => {},
      }),
    );
    await assert.rejects(
      runCodexLocalTurn({
        instructions: "test",
        text: "hello",
        signal: abort.signal,
        onDelta: () => {},
      }),
    );
  } finally {
    clearTimeout(timer);
  }
});

test("UI stream is valid SSE and concurrent requests are rejected", async (t) => {
  setup(t);
  const gateway = new CodexLocalLearningChatGateway();
  const input = {
    messages: [{ role: "user" as const, text: "你好" }],
    systemPrompt: "test",
    maxOutputTokens: 1600,
  };
  const first = gateway.stream(input);
  assert.equal(gateway.stream(input).status, 429);
  const body = await first.text();
  assert.match(body, /text-delta/);
  assert.match(body, /你好/);
  assert.match(body, /\[DONE\]/);
  const aborted = gateway.stream({ ...input, signal: AbortSignal.abort() });
  assert.equal(aborted.status, 200);
  await aborted.text();
});
