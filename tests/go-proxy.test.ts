import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest, NextResponse } from "next/server";
import { GoApiError, type GoTokens } from "../src/infrastructure/go-api/client";
import { goProxy } from "../src/infrastructure/go-api/go-proxy";

const tokens: GoTokens = {
  accessToken: "new-access",
  refreshToken: "new-refresh",
  expiresIn: 900,
};

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

function harness(refresh: (token: string, ip: string) => Promise<GoTokens>) {
  const calls: { token: string; ip: string }[] = [];
  let forwarded: Headers | undefined;
  return {
    calls,
    forwarded: () => forwarded,
    deps: {
      refreshTokens: async (token: string, ip: string) => {
        calls.push({ token, ip });
        return refresh(token, ip);
      },
      next: (_request: NextRequest, headers: Headers) => {
        forwarded = headers;
        const response = NextResponse.next({ request: { headers } });
        response.headers.set("x-test-next", "1");
        return response;
      },
    },
  };
}

function setCookies(response: Response) {
  return response.headers.getSetCookie();
}

test("refreshes a missing access token and forwards the new cookies", async () => {
  const h = harness(async () => tokens);
  const response = await goProxy(
    request("/logs", {
      cookie: "theme=dark; zl_refresh=old-refresh; other=1",
      headers: { "x-real-ip": "203.0.113.5" },
    }),
    h.deps,
  );

  assert.deepEqual(h.calls, [{ token: "old-refresh", ip: "203.0.113.5" }]);
  assert.equal(response.headers.get("x-test-next"), "1");
  const cookies = setCookies(response);
  assert.equal(cookies.length, 2);
  const access = cookies.find((c) => c.startsWith("zl_access=new-access"));
  const refresh = cookies.find((c) => c.startsWith("zl_refresh=new-refresh"));
  assert.ok(access && refresh);
  for (const cookie of [access, refresh]) {
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=lax/i);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Secure/i);
  }
  assert.match(access, /Max-Age=840/);
  assert.match(refresh, /Max-Age=2592000/);

  const cookie = h.forwarded()?.get("cookie") ?? "";
  const pairs = cookie.split(/;\s*/).sort();
  assert.deepEqual(pairs, [
    "other=1",
    "theme=dark",
    "zl_access=new-access",
    "zl_refresh=new-refresh",
  ]);
});

test("cookies are not secure on plain HTTP", async () => {
  const h = harness(async () => tokens);
  const response = await goProxy(
    new NextRequest("http://localhost:3000/logs", {
      headers: { cookie: "zl_refresh=old-refresh" },
    }),
    h.deps,
  );
  for (const cookie of setCookies(response))
    assert.doesNotMatch(cookie, /Secure/i);
});

test("refreshes on /api routes too, so Route Handlers see the new token", async () => {
  const h = harness(async () => tokens);
  const response = await goProxy(
    request("/api/notes", { cookie: "zl_refresh=old-refresh" }),
    h.deps,
  );
  assert.equal(h.calls.length, 1);
  assert.equal(response.status, 200);
  assert.equal(setCookies(response).length, 2);
  assert.match(h.forwarded()?.get("cookie") ?? "", /zl_access=new-access/);
});

test("a rejected refresh token clears both cookies and signs out", async () => {
  const h = harness(async () => {
    throw new GoApiError(401, "unauthorized");
  });
  const response = await goProxy(
    request("/logs", { cookie: "zl_refresh=old-refresh; theme=dark" }),
    h.deps,
  );

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.pathname, "/signin");
  const cookies = setCookies(response);
  assert.equal(cookies.length, 2);
  for (const name of ["zl_access", "zl_refresh"])
    assert.ok(
      cookies.some((c) => c.startsWith(`${name}=;`) && /Max-Age=0/.test(c)),
      name,
    );
});

test("a rejected refresh on a public route drops the cookies from the page request", async () => {
  const h = harness(async () => {
    throw new GoApiError(401, "unauthorized");
  });
  const response = await goProxy(
    request("/signin", { cookie: "zl_refresh=old-refresh; theme=dark" }),
    h.deps,
  );
  assert.equal(response.headers.get("x-test-next"), "1");
  assert.equal(h.forwarded()?.get("cookie"), "theme=dark");
  assert.equal(setCookies(response).length, 2);
});

test("an unreachable Go API leaves the cookies alone and treats the request as signed out", async () => {
  for (const error of [
    new GoApiError(0, "unavailable"),
    new GoApiError(500, "internal"),
  ]) {
    const h = harness(async () => {
      throw error;
    });
    const response = await goProxy(
      request("/logs", { cookie: "zl_refresh=old-refresh" }),
      h.deps,
    );
    assert.equal(response.status, 302);
    assert.equal(
      new URL(response.headers.get("location")!).pathname,
      "/signin",
    );
    assert.deepEqual(setCookies(response), []);
  }
});

test("an existing access token is not refreshed", async () => {
  const h = harness(async () => tokens);
  const response = await goProxy(
    request("/logs", { cookie: "zl_access=a; zl_refresh=r" }),
    h.deps,
  );
  assert.deepEqual(h.calls, []);
  assert.equal(response.headers.get("x-test-next"), "1");
  assert.deepEqual(setCookies(response), []);
  assert.equal(h.forwarded()?.get("cookie"), "zl_access=a; zl_refresh=r");
});

test("signed-out page requests go to /signin with the callback path", async () => {
  const h = harness(async () => tokens);
  const response = await goProxy(request("/logs/new?d=2026-10-22"), h.deps);
  assert.deepEqual(h.calls, []);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.origin, "https://zhuelog.test");
  assert.equal(location.pathname, "/signin");
  assert.equal(
    location.searchParams.get("callbackUrl"),
    "/logs/new?d=2026-10-22",
  );
});

test("signed-out /api requests get a 401 JSON that is not cached", async () => {
  const h = harness(async () => tokens);
  const response = await goProxy(request("/api/notes"), h.deps);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "認証が必要です。" });
});

test("signed-out Server Actions pass through to their own authorization", async () => {
  const h = harness(async () => tokens);
  const response = await goProxy(
    request("/logs", { method: "POST", headers: { "next-action": "abc" } }),
    h.deps,
  );
  assert.equal(response.headers.get("x-test-next"), "1");

  const get = await goProxy(
    request("/logs", { headers: { "next-action": "abc" } }),
    h.deps,
  );
  assert.equal(get.status, 302);
});

test("public routes pass while signed out", async () => {
  for (const path of ["/signin", "/api/auth/callback/github/go?code=x"]) {
    const h = harness(async () => tokens);
    const response = await goProxy(request(path), h.deps);
    assert.equal(response.headers.get("x-test-next"), "1", path);
  }
  const h = harness(async () => tokens);
  const response = await goProxy(request("/signin/other"), h.deps);
  assert.equal(response.status, 302);
});
