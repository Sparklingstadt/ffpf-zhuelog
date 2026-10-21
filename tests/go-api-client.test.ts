import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  goApiUrl,
  isAuthConfigured,
} from "../src/infrastructure/config/environment";
import {
  fetchMe,
  GoApiError,
  goApi,
  loginPassword,
} from "../src/infrastructure/go-api/client";

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
  process.env.GO_API_URL = " http://api.test/ ";
  process.env.API_WEB_PROXY_SECRET = "s3cret-s3cret-s3cret-s3cret-s3cret";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...saved };
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

test("goApiUrl trims, strips trailing slashes and maps empty to undefined", () => {
  assert.equal(goApiUrl(), "http://api.test");
  process.env.GO_API_URL = "   ";
  assert.equal(goApiUrl(), undefined);
  delete process.env.GO_API_URL;
  assert.equal(goApiUrl(), undefined);
});

test("isAuthConfigured keeps the Auth.js rule when GO_API_URL is unset", () => {
  delete process.env.GO_API_URL;
  process.env.AUTH_SECRET = "a";
  process.env.AUTH_GITHUB_ID = "b";
  process.env.AUTH_GITHUB_SECRET = "c";
  process.env.AUTH_ALLOWED_GITHUB_IDS = "1";
  assert.equal(isAuthConfigured(), true);
});

test("isAuthConfigured follows the Go rule when GO_API_URL is set", () => {
  delete process.env.AUTH_GITHUB_ID;
  assert.equal(isAuthConfigured(), false);
  process.env.AUTH_GITHUB_ID = "b";
  assert.equal(isAuthConfigured(), true);
});

test("sends IP and secret headers only with clientIp", async () => {
  stub(() => json({ ok: 1 }));
  await goApi("/v1/x", { method: "POST", body: { a: 1 }, clientIp: "1.2.3.4" });
  const h = calls[0]!.init.headers as Record<string, string>;
  assert.equal(calls[0]!.url, "http://api.test/v1/x");
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

test("fetchMe sends a Bearer token", async () => {
  stub(() => json({ ownerId: "o", role: "member", login: "l" }));
  const me = await fetchMe("tok");
  assert.equal(me.role, "member");
  const h = calls[0]!.init.headers as Record<string, string>;
  assert.equal(h.authorization, "Bearer tok");
});

test("maps the Go error JSON to GoApiError", async () => {
  stub(() => json({ error: { code: "rate_limited", message: "x" } }, 429));
  await assert.rejects(
    loginPassword("u", "pw-secret", "1.1.1.1"),
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
