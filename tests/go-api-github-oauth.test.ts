import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";
import { GoApiError, type GoTokens } from "../src/infrastructure/go-api/client";
import {
  createOAuthStart,
  githubAuthorizeUrl,
  githubRedirectUri,
  parseOAuthCookie,
  pkceChallenge,
  publicOrigin,
  requestOrigin,
} from "../src/infrastructure/go-api/github-oauth";
import { handleGitHubCallback } from "../src/presentation/http/github-callback";

const originalAuthUrl = process.env.AUTH_URL;
afterEach(() => {
  if (originalAuthUrl === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = originalAuthUrl;
});

test("the redirect URI is the Go callback path on the origin", () => {
  assert.equal(
    githubRedirectUri("https://example.com"),
    "https://example.com/api/auth/callback/github/go",
  );
});

test("the origin comes from AUTH_URL when set, else from the request", () => {
  delete process.env.AUTH_URL;
  const headers = new Headers({
    host: "app.example.com",
    "x-forwarded-proto": "https",
  });
  assert.equal(publicOrigin(requestOrigin(headers)), "https://app.example.com");
  assert.equal(
    requestOrigin(new Headers({ host: "localhost:3000" })),
    "http://localhost:3000",
  );
  process.env.AUTH_URL = "https://zhuelog.example/api/auth";
  assert.equal(publicOrigin(requestOrigin(headers)), "https://zhuelog.example");
});

test("an OAuth start has fresh random values and an S256 challenge", () => {
  const a = createOAuthStart("/logs");
  const b = createOAuthStart("/logs");
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.verifier, b.verifier);
  for (const value of [a.state, a.verifier]) {
    assert.match(value, /^[A-Za-z0-9_-]+$/);
    assert.equal(Buffer.from(value, "base64url").length, 32);
  }
  assert.equal(a.challenge, pkceChallenge(a.verifier));
});

test("the PKCE challenge matches the RFC 7636 example", () => {
  assert.equal(
    pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("the cookie value round-trips", () => {
  const start = createOAuthStart("/logs?a=1");
  assert.deepEqual(parseOAuthCookie(start.cookieValue), {
    state: start.state,
    verifier: start.verifier,
    callbackPath: "/logs?a=1",
  });
});

test("a missing or broken cookie value is null", () => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  for (const value of [
    undefined,
    "",
    "not base64 json",
    encode("text"),
    encode(null),
    encode({ state: "s", verifier: "v" }),
    encode({ state: "", verifier: "v", callbackPath: "/" }),
    encode({ state: "s", verifier: 1, callbackPath: "/" }),
  ])
    assert.equal(parseOAuthCookie(value), null, String(value));
});

test("the authorize URL asks GitHub for read:user with PKCE", () => {
  const url = new URL(
    githubAuthorizeUrl({
      clientId: "client-id",
      redirectUri: "https://example.com/api/auth/callback/github/go",
      state: "state-1",
      challenge: "challenge-1",
    }),
  );
  assert.equal(
    `${url.origin}${url.pathname}`,
    "https://github.com/login/oauth/authorize",
  );
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://example.com/api/auth/callback/github/go",
  );
  assert.equal(url.searchParams.get("scope"), "read:user");
  assert.equal(url.searchParams.get("state"), "state-1");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-1");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

const tokens: GoTokens = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresIn: 900,
};

type LoginCall = [string, string, string, string];

function callback(query: string, cookie?: string) {
  const headers = new Headers({
    host: "app.example.com",
    "x-forwarded-proto": "https",
    "x-real-ip": "203.0.113.7",
  });
  if (cookie !== undefined) headers.set("cookie", `zl_oauth=${cookie}`);
  return new NextRequest(
    `https://app.example.com/api/auth/callback/github/go${query}`,
    { headers },
  );
}

function deps(result: GoTokens | Error, enabled = true) {
  const calls: LoginCall[] = [];
  return {
    calls,
    deps: {
      isEnabled: () => enabled,
      login: async (...args: LoginCall) => {
        calls.push(args);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

function setCookies(response: Response) {
  return response.headers.getSetCookie();
}

function assertOAuthCleared(response: Response) {
  const cleared = setCookies(response).find((c) => c.startsWith("zl_oauth="));
  assert.ok(cleared, "zl_oauth is cleared");
  assert.match(cleared, /^zl_oauth=;/);
  assert.match(cleared, /Max-Age=0/i);
}

test("a successful callback sets the session and goes to the saved path", async () => {
  delete process.env.AUTH_URL;
  const start = createOAuthStart("/logs?a=1");
  const { calls, deps: d } = deps(tokens);
  const response = await handleGitHubCallback(
    callback(`?code=code-1&state=${start.state}`, start.cookieValue),
    d,
  );
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    "https://app.example.com/logs?a=1",
  );
  assert.deepEqual(calls, [
    [
      "code-1",
      start.verifier,
      "https://app.example.com/api/auth/callback/github/go",
      "203.0.113.7",
    ],
  ]);
  const cookies = setCookies(response);
  assert.ok(cookies.some((c) => c.startsWith("zl_access=access-1;")));
  assert.ok(cookies.some((c) => c.startsWith("zl_refresh=refresh-1;")));
  for (const c of cookies) {
    assert.match(c, /HttpOnly/i);
    assert.match(c, /SameSite=lax/i);
    assert.match(c, /Secure/i);
  }
  assertOAuthCleared(response);
});

test("an unsafe saved path falls back to /", async () => {
  delete process.env.AUTH_URL;
  const start = createOAuthStart("//evil.example/x");
  const response = await handleGitHubCallback(
    callback(`?code=c&state=${start.state}`, start.cookieValue),
    deps(tokens).deps,
  );
  assert.equal(response.headers.get("location"), "https://app.example.com/");
});

const failure = (code: string) =>
  `https://app.example.com/signin?error=${code}`;

test("a state mismatch is rejected without calling the Go API", async () => {
  delete process.env.AUTH_URL;
  const start = createOAuthStart("/");
  const { calls, deps: d } = deps(tokens);
  for (const state of ["other", `${start.state}x`, ""]) {
    const response = await handleGitHubCallback(
      callback(`?code=c&state=${state}`, start.cookieValue),
      d,
    );
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("location"),
      failure("OAuthCallbackError"),
    );
    assertOAuthCleared(response);
  }
  assert.equal(calls.length, 0);
});

test("an error parameter or a missing cookie is rejected", async () => {
  delete process.env.AUTH_URL;
  const start = createOAuthStart("/");
  const { calls, deps: d } = deps(tokens);
  for (const request of [
    callback(
      `?error=access_denied&state=${start.state}&code=c`,
      start.cookieValue,
    ),
    callback(`?code=c&state=${start.state}`),
    callback(`?state=${start.state}`, start.cookieValue),
  ]) {
    const response = await handleGitHubCallback(request, d);
    assert.equal(
      response.headers.get("location"),
      failure("OAuthCallbackError"),
    );
    assertOAuthCleared(response);
  }
  assert.equal(calls.length, 0);
});

test("a 403 from the Go API is AccessDenied; other failures are OAuthCallbackError", async () => {
  delete process.env.AUTH_URL;
  const start = createOAuthStart("/");
  const request = () =>
    callback(`?code=c&state=${start.state}`, start.cookieValue);
  const cases: [Error, string][] = [
    [new GoApiError(403, "forbidden"), "AccessDenied"],
    [new GoApiError(401, "unauthorized"), "OAuthCallbackError"],
    [new GoApiError(0, "unavailable"), "OAuthCallbackError"],
    [new Error("boom"), "OAuthCallbackError"],
  ];
  for (const [error, code] of cases) {
    const response = await handleGitHubCallback(request(), deps(error).deps);
    assert.equal(response.headers.get("location"), failure(code));
    assert.ok(
      !setCookies(response).some((c) => /^zl_(access|refresh)=/.test(c)),
    );
    assertOAuthCleared(response);
  }
});

test("the callback is 404 without GO_API_URL", async () => {
  const start = createOAuthStart("/");
  const { calls, deps: d } = deps(tokens, false);
  const response = await handleGitHubCallback(
    callback(`?code=c&state=${start.state}`, start.cookieValue),
    d,
  );
  assert.equal(response.status, 404);
  assert.equal(calls.length, 0);
});
