// Mirrors services/api/auth/oauth_error.go, services/api/httpclient and the
// `do` helpers of services/api/auth/github.go and ffpf.go.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OAUTH_MAX_BODY_BYTES,
  OAUTH_TIMEOUT_MS,
  fetchLimited,
  formUrlEncode,
  loggableOAuthErrorCode,
} from "../src/infrastructure/auth/oauth-http";

test("Go's numbers: 10 s and 1 MiB", () => {
  assert.equal(OAUTH_TIMEOUT_MS, 10_000);
  assert.equal(OAUTH_MAX_BODY_BYTES, 1_048_576);
});

test("only code-shaped OAuth errors are logged as is", () => {
  assert.equal(
    loggableOAuthErrorCode("bad_verification_code"),
    "bad_verification_code",
  );
  assert.equal(loggableOAuthErrorCode("a".repeat(64)), "a".repeat(64));
  for (const code of ["Bad", "a-b", "", "a".repeat(65), 1, null, undefined]) {
    assert.equal(loggableOAuthErrorCode(code), "unrecognized", String(code));
  }
});

test("formUrlEncode is Go's url.QueryEscape", () => {
  assert.equal(formUrlEncode("a b"), "a+b");
  assert.equal(formUrlEncode("a+b"), "a%2Bb");
  assert.equal(formUrlEncode("x!'()*~"), "x%21%27%28%29%2A~");
  assert.equal(formUrlEncode("é"), "%C3%A9");
  assert.equal(formUrlEncode("Az09-_.~"), "Az09-_.~");
  assert.equal(formUrlEncode("a:b/c?d=e&f"), "a%3Ab%2Fc%3Fd%3De%26f");
});

function recordingFetch(answer: (url: string) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return answer(url);
  }) as typeof fetch;
  return { fetchFn, calls };
}

test("fetchLimited never follows redirects", async () => {
  const { fetchFn, calls } = recordingFetch(
    () =>
      new Response("", {
        status: 307,
        headers: { location: "https://elsewhere.example/" },
      }),
  );
  const result = await fetchLimited(fetchFn, "https://idp.example/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "a=b",
  });
  assert.deepEqual(result, { status: 307, text: "" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, "a=b");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("fetchLimited cuts the body at maxBytes", async () => {
  const { fetchFn } = recordingFetch(() => new Response("abcdefghij"));
  assert.deepEqual(
    await fetchLimited(
      fetchFn,
      "https://idp.example/x",
      { method: "GET", headers: {} },
      { maxBytes: 4 },
    ),
    { status: 200, text: "abcd" },
  );
  // A multi-chunk body is cut across chunks too.
  const chunked = recordingFetch(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode("abc"));
            controller.enqueue(enc.encode("def"));
            controller.enqueue(enc.encode("ghi"));
            controller.close();
          },
        }),
      ),
  );
  assert.deepEqual(
    await fetchLimited(
      chunked.fetchFn,
      "https://idp.example/x",
      { method: "GET", headers: {} },
      { maxBytes: 5 },
    ),
    { status: 200, text: "abcde" },
  );
  // The default limit keeps a body of exactly 1 MiB whole.
  const big = "a".repeat(OAUTH_MAX_BODY_BYTES + 10);
  const whole = recordingFetch(() => new Response(big));
  const result = await fetchLimited(whole.fetchFn, "https://idp.example/x", {
    method: "GET",
    headers: {},
  });
  assert.notEqual(result, "unavailable");
  if (result !== "unavailable")
    assert.equal(result.text.length, OAUTH_MAX_BODY_BYTES);
});

test('fetchLimited turns a network error or a timeout into "unavailable"', async () => {
  const failing = recordingFetch(() => {
    throw new TypeError("fetch failed: secret-in-cause");
  });
  assert.equal(
    await fetchLimited(failing.fetchFn, "https://idp.example/x", {
      method: "GET",
      headers: {},
    }),
    "unavailable",
  );

  // Never answers until aborted.
  const silent = (async (_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(init.signal?.reason),
      );
    })) as typeof fetch;
  const startedAt = Date.now();
  assert.equal(
    await fetchLimited(
      silent,
      "https://idp.example/x",
      { method: "GET", headers: {} },
      { timeoutMs: 20 },
    ),
    "unavailable",
  );
  assert.ok(Date.now() - startedAt < 5_000);

  // A body that fails while being read.
  const broken = recordingFetch(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("ab"));
            controller.error(new Error("reset"));
          },
        }),
      ),
  );
  assert.equal(
    await fetchLimited(broken.fetchFn, "https://idp.example/x", {
      method: "GET",
      headers: {},
    }),
    "unavailable",
  );
});
