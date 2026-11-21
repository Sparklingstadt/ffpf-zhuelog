import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { NextRequest, NextResponse } from "next/server";
import {
  isMetadataFile,
  isPublicRoute,
  sessionGate,
} from "../src/presentation/http/session-gate";

const realFetch = globalThis.fetch;
beforeEach(() => {
  // The gate must never look anything up; any fetch fails the test.
  globalThis.fetch = (() => {
    throw new Error("the gate must not fetch");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function request(
  path: string,
  init: {
    cookie?: string;
    method?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new NextRequest(`https://zhuelog.test${path}`, {
    method: init.method ?? "GET",
    headers,
  });
}

function harness() {
  const seen: NextRequest[] = [];
  return {
    seen,
    next: (req: NextRequest) => {
      seen.push(req);
      const response = NextResponse.next();
      response.headers.set("x-test-next", "1");
      return response;
    },
  };
}

test("a session cookie passes the gate without any lookup", () => {
  const h = harness();
  const response = sessionGate(
    request("/logs", { cookie: `theme=dark; zl_session=${"T".repeat(43)}` }),
    h.next,
  );
  assert.equal(h.seen.length, 1);
  assert.equal(response.headers.get("x-test-next"), "1");
  // The cookie header reaches the page as the browser sent it.
  assert.equal(
    h.seen[0]!.headers.get("cookie"),
    `theme=dark; zl_session=${"T".repeat(43)}`,
  );
});

test("signed-out page requests go to /signin with the callback path", () => {
  const h = harness();
  const response = sessionGate(request("/logs?x=1"), h.next);
  assert.equal(h.seen.length, 0);
  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("location"),
    "https://zhuelog.test/signin?callbackUrl=%2Flogs%3Fx%3D1",
  );
});

test("an empty session cookie is signed out", () => {
  const h = harness();
  const response = sessionGate(
    request("/logs", { cookie: "zl_session=" }),
    h.next,
  );
  assert.equal(response.status, 302);
  assert.equal(h.seen.length, 0);
});

test("the old Go cookies alone are signed out", () => {
  const h = harness();
  const response = sessionGate(
    request("/logs", { cookie: "zl_access=a; zl_refresh=r" }),
    h.next,
  );
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")!).pathname, "/signin");
  assert.equal(h.seen.length, 0);
});

test("signed-out /api requests get a 401 JSON that is not cached", async () => {
  const h = harness();
  const response = sessionGate(request("/api/notes"), h.next);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "認証が必要です。" });
  assert.equal(h.seen.length, 0);
});

test("signed-out Server Actions pass through to their own authorization", () => {
  const h = harness();
  const response = sessionGate(
    request("/logs", { method: "POST", headers: { "next-action": "abc" } }),
    h.next,
  );
  assert.equal(response.headers.get("x-test-next"), "1");

  const get = sessionGate(
    request("/logs", { headers: { "next-action": "abc" } }),
    h.next,
  );
  assert.equal(get.status, 302);
});

test("public routes pass while signed out", () => {
  for (const path of [
    "/signin",
    "/api/auth/callback/github/go?code=x",
    "/api/auth/callback/ffpf?code=x",
    "/robots.txt",
    "/sitemap.xml",
    "/opengraph-image.png?a1b2c3",
    "/opengraph-image",
    "/twitter-image.png",
  ]) {
    const h = harness();
    const response = sessionGate(request(path), h.next);
    assert.equal(response.headers.get("x-test-next"), "1", path);
    assert.equal(h.seen.length, 1, path);
  }
});

test("the LINE webhook and the cron routes are public", async () => {
  for (const [method, path] of [
    ["POST", "/api/line/webhook"],
    ["GET", "/api/cron/line-drain"],
    ["GET", "/api/cron/demo-reset"],
  ]) {
    const h = harness();
    const response = sessionGate(request(path!, { method }), h.next);
    assert.equal(response.headers.get("x-test-next"), "1", path);
  }
  for (const [method, path] of [
    ["POST", "/api/line/webhooks"],
    ["POST", "/api/line/link"],
    ["GET", "/api/cronx"],
  ]) {
    const h = harness();
    const response = sessionGate(request(path!, { method }), h.next);
    assert.equal(response.status, 401, path);
    assert.deepEqual(await response.json(), { error: "認証が必要です。" });
  }
});

test("a route that only looks public is gated", () => {
  for (const path of ["/signin/other", "/robots.txt/x", "/opengraph-images"]) {
    const response = sessionGate(request(path), harness().next);
    assert.equal(response.status, 302, path);
  }
  const api = sessionGate(request("/api/authx"), harness().next);
  assert.equal(api.status, 401);
  assert.equal(isPublicRoute("/signin/other"), false);
  assert.equal(isPublicRoute("/api/authx"), false);
  assert.equal(isPublicRoute("/api/auth/callback/ffpf"), true);
});

test("the gate never sets cookies", () => {
  const cases: [string, Parameters<typeof request>[1]][] = [
    ["/logs", { cookie: `zl_session=${"T".repeat(43)}` }],
    ["/logs", { cookie: "zl_access=a; zl_refresh=r; zl_act_as=password:a" }],
    ["/logs", {}],
    ["/api/notes", {}],
    ["/signin", { cookie: "zl_refresh=r" }],
    ["/logs", { method: "POST", headers: { "next-action": "abc" } }],
  ];
  for (const [path, init] of cases) {
    const response = sessionGate(request(path, init), harness().next);
    assert.deepEqual(response.headers.getSetCookie(), [], path);
    assert.equal(response.headers.get("set-cookie"), null, path);
  }
});

test("only the metadata files Next.js serves for crawlers count as metadata files", () => {
  for (const path of [
    "/robots.txt",
    "/sitemap.xml",
    "/opengraph-image",
    "/opengraph-image.png",
    "/twitter-image.jpg",
  ]) {
    assert.equal(isMetadataFile(path), true, path);
  }
  for (const path of [
    "/",
    "/signin",
    "/logs/robots.txt",
    "/sitemap.xml.bak",
    "/opengraph-image.png/x",
    "/opengraph-images",
    "/api/robots.txt",
  ]) {
    assert.equal(isMetadataFile(path), false, path);
  }
});
