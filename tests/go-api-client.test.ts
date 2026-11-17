import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { goApiUrl } from "../src/infrastructure/config/environment";
import { GoApiError, goApi } from "../src/infrastructure/go-api/client";

const realFetch = globalThis.fetch;
const saved = { ...process.env };
let calls: { url: string; init: RequestInit }[] = [];

function stub(respond: () => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.GO_API_URL = " https://api.test/ ";
  process.env.API_WEB_PROXY_SECRET = "s3cret-s3cret-s3cret-s3cret-s3cret";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...saved };
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

test("goApiUrl trims, strips trailing slashes and maps empty to undefined", () => {
  assert.equal(goApiUrl(), "https://api.test");
  process.env.GO_API_URL = "   ";
  assert.equal(goApiUrl(), undefined);
  delete process.env.GO_API_URL;
  assert.equal(goApiUrl(), undefined);
});

test("sends IP and secret headers only with clientIp", async () => {
  stub(() => json({ ok: 1 }));
  await goApi("/v1/x", { method: "POST", body: { a: 1 }, clientIp: "1.2.3.4" });
  const h = calls[0]!.init.headers as Record<string, string>;
  assert.equal(calls[0]!.url, "https://api.test/v1/x");
  assert.equal(h["X-Zhuelog-Client-IP"], "1.2.3.4");
  assert.equal(h["X-Zhuelog-Proxy-Secret"], process.env.API_WEB_PROXY_SECRET);
  assert.equal(h["content-type"], "application/json");
  assert.equal(calls[0]!.init.body, '{"a":1}');
  assert.equal(calls[0]!.init.cache, "no-store");
  assert.ok(calls[0]!.init.signal);

  await goApi("/v1/x", { method: "GET" });
  const h2 = calls[1]!.init.headers as Record<string, string>;
  assert.equal(h2["X-Zhuelog-Client-IP"], undefined);
  assert.equal(h2["X-Zhuelog-Proxy-Secret"], undefined);
  assert.equal(h2.authorization, undefined);
});

test("maps the Go error JSON to GoApiError", async () => {
  stub(() => json({ error: { code: "rate_limited", message: "x" } }, 429));
  await assert.rejects(
    goApi("/v1/x", { method: "POST", body: { password: "pw-secret" } }),
    (e: unknown) =>
      e instanceof GoApiError &&
      e.status === 429 &&
      e.code === "rate_limited" &&
      !e.message.includes("pw-secret"),
  );
});

test("a non-JSON error body becomes code unknown", async () => {
  stub(() => new Response("<html>", { status: 502 }));
  await assert.rejects(
    goApi("/v1/x", { method: "GET" }),
    (e: unknown) =>
      e instanceof GoApiError && e.status === 502 && e.code === "unknown",
  );
});

test("network errors and timeouts become status 0 unavailable", async () => {
  stub(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(
    goApi("/v1/x", { method: "GET" }),
    (e: unknown) =>
      e instanceof GoApiError && e.status === 0 && e.code === "unavailable",
  );
});

test("a 2xx with invalid JSON becomes GoApiError unknown", async () => {
  stub(() => new Response("not json", { status: 200 }));
  await assert.rejects(
    goApi("/v1/x", { method: "GET" }),
    (e: unknown) =>
      e instanceof GoApiError && e.status === 200 && e.code === "unknown",
  );
});

test("an empty 2xx body returns undefined", async () => {
  stub(() => new Response(null, { status: 204 }));
  assert.equal(await goApi("/v1/x", { method: "POST" }), undefined);
});

test("a failing body read becomes GoApiError", async () => {
  stub(() => {
    const body = new ReadableStream({
      start(c) {
        c.error(new Error("boom"));
      },
    });
    return new Response(body, { status: 200 });
  });
  await assert.rejects(
    goApi("/v1/x", { method: "GET" }),
    (e: unknown) => e instanceof GoApiError && e.code === "unknown",
  );
});

test("fetch is called with redirect error", async () => {
  stub(() => json({}));
  await goApi("/v1/x", { method: "GET" });
  assert.equal(calls[0]!.init.redirect, "error");
});

test("without a proxy secret neither IP nor secret header is sent", async () => {
  delete process.env.API_WEB_PROXY_SECRET;
  stub(() => json({}));
  await goApi("/v1/x", { method: "POST", clientIp: "1.2.3.4" });
  const h = calls[0]!.init.headers as Record<string, string>;
  assert.equal(h["X-Zhuelog-Client-IP"], undefined);
  assert.equal(h["X-Zhuelog-Proxy-Secret"], undefined);
});

test("GoApiError carries the Go message apart from Error.message", async () => {
  stub(() =>
    json(
      { error: { code: "invalid_request", message: "3 行目が空です" } },
      400,
    ),
  );
  await assert.rejects(
    goApi("/v1/x", { method: "POST" }),
    (e: unknown) =>
      e instanceof GoApiError &&
      e.code === "invalid_request" &&
      e.userMessage === "3 行目が空です" &&
      !e.message.includes("3 行目"),
  );
});

test("the Go message is empty when the body has none", async () => {
  for (const body of [
    new Response("<html>", { status: 502 }),
    json({ error: { code: "x" } }, 400),
    json({ error: { code: "x", message: 5 } }, 400),
  ]) {
    stub(() => body);
    await assert.rejects(
      goApi("/v1/x", { method: "GET" }),
      (e: unknown) => e instanceof GoApiError && e.userMessage === "",
    );
  }
  assert.equal(new GoApiError(0, "unavailable").userMessage, "");
});

test("an unsafe GO_API_URL is refused before anything is sent", async () => {
  for (const url of [
    "http://api.test",
    "http://localhost.evil.test",
    "http://10.0.0.1:3108",
    "ftp://localhost",
    "not a url",
  ]) {
    process.env.GO_API_URL = url;
    stub(() => json({ ok: 1 }));
    await assert.rejects(
      goApi("/v1/x", {
        method: "POST",
        accessToken: "tok",
        clientIp: "1.2.3.4",
      }),
      (error: unknown) =>
        error instanceof GoApiError &&
        error.status === 0 &&
        error.code === "unavailable",
      url,
    );
    assert.equal(calls.length, 0, url);
  }
});

test("plain HTTP is allowed for this machine (local development and e2e)", async () => {
  for (const url of ["http://127.0.0.1:3108", "http://localhost:3108/"]) {
    process.env.GO_API_URL = url;
    stub(() => json({ ok: 1 }));
    await goApi("/v1/x", { method: "GET", accessToken: "tok" });
    assert.equal(calls[0]!.url, `${url.replace(/\/$/, "")}/v1/x`);
  }
});
