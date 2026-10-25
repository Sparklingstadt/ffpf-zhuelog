import assert from "node:assert/strict";
import { test } from "node:test";

import { handleChatRelay } from "../src/presentation/controllers/chat-relay-controller";

const body = JSON.stringify({ messages: [{ role: "user", text: "你好" }] });

function request(
  init: { origin?: string; contentType?: string; body?: string } = {},
) {
  return new Request("http://app.test/api/chat", {
    method: "POST",
    headers: {
      host: "app.test",
      origin: init.origin ?? "http://app.test",
      "content-type": init.contentType ?? "application/json",
    },
    body: init.body ?? body,
  });
}

function fakeGo(response: Response | Error) {
  const calls: { path: string; init: RequestInit }[] = [];
  const fetchGo = async (path: string, init: RequestInit) => {
    calls.push({ path, init });
    if (response instanceof Error) throw response;
    return response;
  };
  return { fetchGo, calls };
}

async function errorOf(response: Response) {
  return ((await response.json()) as { error: string }).error;
}

test("relay rejects cross-origin with 403", async () => {
  const { fetchGo, calls } = fakeGo(new Response(""));
  const response = await handleChatRelay(
    request({ origin: "http://evil.test" }),
    { accessToken: "tok", fetchGo },
  );
  assert.equal(response.status, 403);
  assert.equal(await errorOf(response), "この画面から送信してください。");
  assert.equal(calls.length, 0);
});

test("relay rejects non-JSON with 415", async () => {
  const { fetchGo } = fakeGo(new Response(""));
  const response = await handleChatRelay(
    request({ contentType: "text/plain" }),
    { accessToken: "tok", fetchGo },
  );
  assert.equal(response.status, 415);
});

test("relay answers 401 without a token", async () => {
  const { fetchGo, calls } = fakeGo(new Response(""));
  const response = await handleChatRelay(request(), {
    accessToken: undefined,
    fetchGo,
  });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("relay rejects bodies over 256 KiB with 413", async () => {
  const { fetchGo, calls } = fakeGo(new Response(""));
  const response = await handleChatRelay(
    request({ body: "a".repeat(256 * 1024 + 1) }),
    { accessToken: "tok", fetchGo },
  );
  assert.equal(response.status, 413);
  assert.equal(await errorOf(response), "会話が大きすぎます。");
  assert.equal(calls.length, 0);
});

test("relay forwards body and bearer token to /v1/chat", async () => {
  const { fetchGo, calls } = fakeGo(new Response(""));
  await handleChatRelay(request(), { accessToken: "tok", fetchGo });
  assert.equal(calls.length, 1);
  const [{ path, init }] = calls;
  assert.equal(path, "/v1/chat");
  assert.equal(init.method, "POST");
  const headers = new Headers(init.headers);
  assert.equal(headers.get("authorization"), "Bearer tok");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(new TextDecoder().decode(init.body as Uint8Array), body);
});

test("relay passes Go status, content-type and body through", async () => {
  const stream = '{"type":"delta","text":"你"}\n{"type":"done"}\n';
  const ok = fakeGo(
    new Response(stream, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8" },
    }),
  );
  const response = await handleChatRelay(request(), {
    accessToken: "tok",
    fetchGo: ok.fetchGo,
  });
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/x-ndjson; charset=utf-8",
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), stream);

  const failed = fakeGo(
    Response.json(
      { error: { code: "chat_failed", message: "x" } },
      { status: 502 },
    ),
  );
  const bad = await handleChatRelay(request(), {
    accessToken: "tok",
    fetchGo: failed.fetchGo,
  });
  assert.equal(bad.status, 502);
  assert.deepEqual(await bad.json(), {
    error: { code: "chat_failed", message: "x" },
  });
});

test("relay answers 502 when Go is unreachable", async () => {
  const { fetchGo } = fakeGo(new Error("ECONNREFUSED"));
  const response = await handleChatRelay(request(), {
    accessToken: "tok",
    fetchGo,
  });
  assert.equal(response.status, 502);
  assert.equal(
    await errorOf(response),
    "ChatGPTから応答を受信できませんでした。",
  );
});
