import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";
import { ffpfIdConfig } from "../src/infrastructure/config/environment";
import { GoApiError, type GoTokens } from "../src/infrastructure/go-api/client";
import {
  createFfpfOAuthStart,
  FFPF_CALLBACK_PATH,
  ffpfAuthorizeUrl,
  ffpfRedirectUri,
  parseFfpfOAuthCookie,
} from "../src/infrastructure/go-api/ffpf-oauth";
import {
  createOAuthStart,
  parseOAuthCookie,
} from "../src/infrastructure/go-api/github-oauth";
import { handleFfpfCallback } from "../src/presentation/http/ffpf-callback";

const originalEnv = {
  AUTH_URL: process.env.AUTH_URL,
  FFPF_ID_ISSUER: process.env.FFPF_ID_ISSUER,
  FFPF_ID_CLIENT_ID: process.env.FFPF_ID_CLIENT_ID,
};
afterEach(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("the redirect URI is the FFPF callback path on the origin", () => {
  assert.equal(FFPF_CALLBACK_PATH, "/api/auth/callback/ffpf");
  assert.equal(
    ffpfRedirectUri("https://example.com"),
    "https://example.com/api/auth/callback/ffpf",
  );
});

test("the authorize URL asks the issuer for openid email profile with PKCE and a nonce", () => {
  const url = new URL(
    ffpfAuthorizeUrl({
      issuer: "https://portal.example",
      clientId: "zhuelog",
      redirectUri: "https://example.com/api/auth/callback/ffpf",
      state: "state-1",
      challenge: "challenge-1",
      nonce: "nonce-1",
    }),
  );
  assert.equal(
    `${url.origin}${url.pathname}`,
    "https://portal.example/oauth/authorize",
  );
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "zhuelog");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://example.com/api/auth/callback/ffpf",
  );
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("state"), "state-1");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-1");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("nonce"), "nonce-1");
});

test("an FFPF start has fresh random values, an S256 challenge and a nonce", () => {
  const a = createFfpfOAuthStart("/logs");
  const b = createFfpfOAuthStart("/logs");
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.nonce, b.nonce);
  for (const value of [a.state, a.verifier, a.nonce]) {
    assert.match(value, /^[A-Za-z0-9_-]+$/);
    assert.equal(Buffer.from(value, "base64url").length, 32);
  }
  assert.match(a.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.challenge, a.verifier);
});

test("the FFPF cookie value round-trips", () => {
  const start = createFfpfOAuthStart("/logs?a=1");
  assert.deepEqual(parseFfpfOAuthCookie(start.cookieValue), {
    state: start.state,
    verifier: start.verifier,
    nonce: start.nonce,
    callbackPath: "/logs?a=1",
    provider: "ffpf",
  });
});

test("a GitHub cookie never parses as FFPF, and an FFPF cookie never as GitHub", () => {
  assert.equal(parseFfpfOAuthCookie(createOAuthStart("/").cookieValue), null);
  assert.equal(parseOAuthCookie(createFfpfOAuthStart("/").cookieValue), null);
});

test("a missing or broken FFPF cookie value is null", () => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const valid = {
    provider: "ffpf",
    state: "s",
    verifier: "v",
    nonce: "n",
    callbackPath: "/",
  };
  for (const value of [
    undefined,
    "",
    "not base64 json",
    encode("text"),
    encode(null),
    encode({ ...valid, provider: "github" }),
    encode({ ...valid, provider: undefined }),
    encode({ ...valid, nonce: "" }),
    encode({ ...valid, nonce: 1 }),
    encode({ ...valid, state: "" }),
    encode({ ...valid, verifier: "" }),
    encode({ ...valid, callbackPath: 1 }),
  ])
    assert.equal(parseFfpfOAuthCookie(value), null, String(value));
});

test("ffpfIdConfig needs both the issuer and the client id", () => {
  process.env.FFPF_ID_ISSUER = " https://portal.example/ ";
  process.env.FFPF_ID_CLIENT_ID = " zhuelog ";
  assert.deepEqual(ffpfIdConfig(), {
    issuer: "https://portal.example",
    clientId: "zhuelog",
  });
  process.env.FFPF_ID_ISSUER = "http://127.0.0.1:3100";
  assert.equal(ffpfIdConfig()?.issuer, "http://127.0.0.1:3100");

  for (const issuer of [
    "",
    "http://portal.example",
    "javascript:alert(1)",
    "portal.example",
  ]) {
    process.env.FFPF_ID_ISSUER = issuer;
    assert.equal(ffpfIdConfig(), undefined, issuer);
  }
  process.env.FFPF_ID_ISSUER = "https://portal.example";
  process.env.FFPF_ID_CLIENT_ID = "";
  assert.equal(ffpfIdConfig(), undefined);
  delete process.env.FFPF_ID_CLIENT_ID;
  assert.equal(ffpfIdConfig(), undefined);
});

const tokens: GoTokens = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresIn: 900,
};

type LoginCall = [string, string, string, string, string];

function callback(query: string, cookie?: string) {
  const headers = new Headers({
    host: "app.example.com",
    "x-forwarded-proto": "https",
    "x-real-ip": "203.0.113.7",
  });
  if (cookie !== undefined) headers.set("cookie", `zl_oauth=${cookie}`);
  return new NextRequest(
    `https://app.example.com/api/auth/callback/ffpf${query}`,
    { headers },
  );
}

function deps(result: GoTokens | Error) {
  const calls: LoginCall[] = [];
  return {
    calls,
    deps: {
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

const failure = "https://app.example.com/signin?error=OAuthCallbackError";

test("a successful callback passes the cookie's verifier and nonce and sets the session", async () => {
  delete process.env.AUTH_URL;
  const start = createFfpfOAuthStart("/logs?a=1");
  const { calls, deps: d } = deps(tokens);
  const response = await handleFfpfCallback(
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
      ffpfRedirectUri("https://app.example.com"),
      start.nonce,
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

test("the redirect URI follows AUTH_URL, and an unsafe saved path falls back to /", async () => {
  process.env.AUTH_URL = "https://zhuelog.example/api/auth";
  const start = createFfpfOAuthStart("//evil.example/x");
  const { calls, deps: d } = deps(tokens);
  const response = await handleFfpfCallback(
    callback(`?code=c&state=${start.state}`, start.cookieValue),
    d,
  );
  assert.equal(response.headers.get("location"), "https://zhuelog.example/");
  assert.equal(calls[0]?.[2], "https://zhuelog.example/api/auth/callback/ffpf");
});

test("a missing cookie, a state mismatch or an error parameter never calls the Go API", async () => {
  delete process.env.AUTH_URL;
  const start = createFfpfOAuthStart("/");
  const github = createOAuthStart("/");
  const { calls, deps: d } = deps(tokens);
  for (const request of [
    callback(`?code=c&state=${start.state}`),
    callback(`?code=c&state=${github.state}`, github.cookieValue),
    callback(`?code=c&state=other`, start.cookieValue),
    callback(`?code=c&state=${start.state}x`, start.cookieValue),
    callback(`?code=c&state=`, start.cookieValue),
    callback(`?state=${start.state}`, start.cookieValue),
    callback(
      `?error=access_denied&state=${start.state}&code=c`,
      start.cookieValue,
    ),
    callback(`?error=access_denied&state=${start.state}`, start.cookieValue),
  ]) {
    const response = await handleFfpfCallback(request, d);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), failure);
    assert.ok(
      !setCookies(response).some((c) => /^zl_(access|refresh)=/.test(c)),
    );
    assertOAuthCleared(response);
  }
  assert.equal(calls.length, 0);
});

test("any failure from the Go API is OAuthCallbackError", async () => {
  delete process.env.AUTH_URL;
  const start = createFfpfOAuthStart("/");
  for (const error of [
    new GoApiError(401, "unauthorized"),
    new GoApiError(403, "forbidden"),
    new GoApiError(502, "ffpf_unavailable"),
    new GoApiError(503, "unavailable"),
    new GoApiError(0, "unavailable"),
    new Error("boom"),
  ]) {
    const response = await handleFfpfCallback(
      callback(`?code=c&state=${start.state}`, start.cookieValue),
      deps(error).deps,
    );
    assert.equal(response.headers.get("location"), failure, error.message);
    assert.ok(
      !setCookies(response).some((c) => /^zl_(access|refresh)=/.test(c)),
    );
    assertOAuthCleared(response);
  }
});
