import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";
import {
  createOAuthStart,
  githubAuthorizeUrl,
  githubRedirectUri,
  parseOAuthCookie,
  pkceChallenge,
  publicOrigin,
  requestOrigin,
} from "../src/infrastructure/auth/github-oauth";
import type {
  IssuedSession,
  SignInResult,
} from "../src/application/identity/sign-in";
import { signedInCookieWrites } from "../src/infrastructure/auth/session-cookies";
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
  // S256 of a 32-byte verifier is 43 base64url characters. The hash itself
  // is checked against the RFC 7636 example below.
  assert.match(a.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.challenge, a.verifier);
  assert.notEqual(a.challenge, b.challenge);
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

// The callback, with the sign-in faked: the code exchange itself is tested
// in github-oauth-client.test.ts and sign-in.test.ts.
type SignInCall = [
  { code: string; verifier: string; redirectUri: string },
  string,
];

const issued: IssuedSession = {
  token: "new-session-token",
  maxAgeSeconds: 2_592_000,
};

function callback(query: string, cookies: Record<string, string> = {}) {
  const headers = new Headers({
    host: "app.example.com",
    "x-forwarded-proto": "https",
    "x-real-ip": "203.0.113.7",
  });
  const pairs = Object.entries(cookies).map(([k, v]) => `${k}=${v}`);
  if (pairs.length) headers.set("cookie", pairs.join("; "));
  return new NextRequest(
    `https://app.example.com/api/auth/callback/github/go${query}`,
    { headers },
  );
}

function deps(result: SignInResult | Error) {
  const calls: SignInCall[] = [];
  const previous: (string | undefined)[] = [];
  return {
    calls,
    previous,
    deps: {
      signIn: async (...args: SignInCall) => {
        calls.push(args);
        if (result instanceof Error) throw result;
        return result;
      },
      sessionCookies: async (
        previousToken: string | undefined,
        session: IssuedSession,
        secure: boolean,
      ) => {
        previous.push(previousToken);
        return signedInCookieWrites(session, secure);
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

function quietConsole() {
  const logged: unknown[][] = [];
  const original = { warn: console.warn, error: console.error };
  console.warn = (...args: unknown[]) => void logged.push(args);
  console.error = (...args: unknown[]) => void logged.push(args);
  return {
    logged,
    restore() {
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

test("a successful callback sets zl_session, clears the act-as and Go cookies and goes to the saved path", async () => {
  process.env.AUTH_URL = "https://zhuelog.test";
  const start = createOAuthStart("/notes?x=1");
  const { calls, deps: d } = deps({ ok: true, session: issued });
  const response = await handleGitHubCallback(
    callback(`?code=code-1&state=${start.state}`, {
      zl_oauth: start.cookieValue,
    }),
    d,
  );
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    "https://zhuelog.test/notes?x=1",
  );
  assert.deepEqual(calls, [
    [
      {
        code: "code-1",
        verifier: start.verifier,
        redirectUri: "https://zhuelog.test/api/auth/callback/github/go",
      },
      "203.0.113.7",
    ],
  ]);
  const cookies = setCookies(response);
  assert.equal(cookies.length, 5);
  const starts = [
    /^zl_oauth=;/,
    /^zl_session=new-session-token;.*Max-Age=2592000/i,
    /^zl_act_as=;/,
    /^zl_access=;/,
    /^zl_refresh=;/,
  ];
  for (const pattern of starts)
    assert.ok(
      cookies.some((c) => pattern.test(c)),
      `${pattern} in ${cookies.join(" | ")}`,
    );
  for (const c of cookies) {
    assert.match(c, /HttpOnly/i);
    assert.match(c, /SameSite=lax/i);
    assert.match(c, /Path=\//);
    assert.match(c, /Secure/i);
  }
});

test("the redirect URI follows the request without AUTH_URL", async () => {
  delete process.env.AUTH_URL;
  const start = createOAuthStart("/");
  const { calls, deps: d } = deps({ ok: true, session: issued });
  await handleGitHubCallback(
    callback(`?code=c&state=${start.state}`, { zl_oauth: start.cookieValue }),
    d,
  );
  assert.equal(
    calls[0]?.[0].redirectUri,
    "https://app.example.com/api/auth/callback/github/go",
  );
});

test("a browser's previous session is handed over to be ended", async () => {
  delete process.env.AUTH_URL;
  const start = createOAuthStart("/");
  const { previous, deps: d } = deps({ ok: true, session: issued });
  await handleGitHubCallback(
    callback(`?code=c&state=${start.state}`, {
      zl_oauth: start.cookieValue,
      zl_session: "old-token",
    }),
    d,
  );
  await handleGitHubCallback(
    callback(`?code=c&state=${start.state}`, { zl_oauth: start.cookieValue }),
    d,
  );
  assert.deepEqual(previous, ["old-token", undefined]);
});

test("an unsafe saved path falls back to /", async () => {
  delete process.env.AUTH_URL;
  const start = createOAuthStart("//evil.example/x");
  const response = await handleGitHubCallback(
    callback(`?code=c&state=${start.state}`, { zl_oauth: start.cookieValue }),
    deps({ ok: true, session: issued }).deps,
  );
  assert.equal(response.headers.get("location"), "https://app.example.com/");
});

const failure = (code: string) =>
  `https://app.example.com/signin?error=${code}`;

test("a state mismatch is rejected without signing in", async () => {
  delete process.env.AUTH_URL;
  const start = createOAuthStart("/");
  const { calls, deps: d } = deps({ ok: true, session: issued });
  for (const state of ["other", `${start.state}x`, ""]) {
    const response = await handleGitHubCallback(
      callback(`?code=c&state=${state}`, { zl_oauth: start.cookieValue }),
      d,
    );
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("location"),
      failure("OAuthCallbackError"),
    );
    assertOAuthCleared(response);
    assert.equal(setCookies(response).length, 1);
  }
  assert.equal(calls.length, 0);
});

test("an error parameter or a missing cookie is rejected", async () => {
  delete process.env.AUTH_URL;
  const start = createOAuthStart("/");
  const { calls, deps: d } = deps({ ok: true, session: issued });
  for (const request of [
    callback(`?error=access_denied&state=${start.state}&code=c`, {
      zl_oauth: start.cookieValue,
    }),
    callback(`?code=c&state=${start.state}`),
    callback(`?state=${start.state}`, { zl_oauth: start.cookieValue }),
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

test("forbidden is AccessDenied; other failures and errors are OAuthCallbackError", async () => {
  delete process.env.AUTH_URL;
  const start = createOAuthStart("/");
  const cases: [SignInResult | Error, string][] = [
    [{ ok: false, reason: "forbidden" }, "AccessDenied"],
    [{ ok: false, reason: "invalid" }, "OAuthCallbackError"],
    [{ ok: false, reason: "unavailable" }, "OAuthCallbackError"],
    [{ ok: false, reason: "throttled" }, "OAuthCallbackError"],
    [new Error("db"), "OAuthCallbackError"],
  ];
  const spy = quietConsole();
  try {
    for (const [result, code] of cases) {
      const response = await handleGitHubCallback(
        callback(`?code=c&state=${start.state}`, {
          zl_oauth: start.cookieValue,
        }),
        deps(result).deps,
      );
      assert.equal(response.headers.get("location"), failure(code));
      assert.ok(!setCookies(response).some((c) => /^zl_session=/.test(c)));
      assertOAuthCleared(response);
    }
  } finally {
    spy.restore();
  }
  assert.deepEqual(spy.logged, [
    ["SIGN_IN_GITHUB_REFUSED", "forbidden"],
    ["SIGN_IN_GITHUB_REFUSED", "invalid"],
    ["SIGN_IN_GITHUB_REFUSED", "unavailable"],
    ["SIGN_IN_GITHUB_REFUSED", "throttled"],
    ["SIGN_IN_GITHUB_FAILED", "Error"],
  ]);
});

test("nothing secret is logged", async () => {
  delete process.env.AUTH_URL;
  const start = createOAuthStart("/");
  const spy = quietConsole();
  try {
    for (const result of [
      { ok: false, reason: "invalid" } as const,
      new Error(`boom code-secret ${start.verifier}`),
    ])
      await handleGitHubCallback(
        callback(`?code=code-secret&state=${start.state}`, {
          zl_oauth: start.cookieValue,
          zl_session: "old-token-secret",
        }),
        deps(result).deps,
      );
  } finally {
    spy.restore();
  }
  const text = JSON.stringify(spy.logged);
  assert.ok(spy.logged.length > 0);
  for (const secret of [
    "code-secret",
    start.state,
    start.verifier,
    start.cookieValue,
    "old-token-secret",
  ])
    assert.ok(!text.includes(secret), secret);
});
