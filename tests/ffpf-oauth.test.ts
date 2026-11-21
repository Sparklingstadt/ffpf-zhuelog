import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";
import { ffpfIdConfig } from "../src/infrastructure/config/environment";
import type {
  IssuedSession,
  SignInResult,
} from "../src/application/identity/sign-in";
import {
  createFfpfOAuthStart,
  FFPF_CALLBACK_PATH,
  ffpfAuthorizeUrl,
  ffpfRedirectUri,
  parseFfpfOAuthCookie,
} from "../src/infrastructure/auth/ffpf-oauth";
import {
  createOAuthStart,
  parseOAuthCookie,
} from "../src/infrastructure/auth/github-oauth";
import { signedInCookieWrites } from "../src/infrastructure/auth/session-cookies";
import { handleFfpfCallback } from "../src/presentation/http/ffpf-callback";

const originalEnv = {
  AUTH_URL: process.env.AUTH_URL,
  FFPF_ID_ISSUER: process.env.FFPF_ID_ISSUER,
  FFPF_ID_CLIENT_ID: process.env.FFPF_ID_CLIENT_ID,
  FFPF_ID_CLIENT_SECRET: process.env.FFPF_ID_CLIENT_SECRET,
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

test("ffpfIdConfig needs the issuer, the client id and the secret", () => {
  process.env.FFPF_ID_ISSUER = " https://portal.example/ ";
  process.env.FFPF_ID_CLIENT_ID = " zhuelog ";
  process.env.FFPF_ID_CLIENT_SECRET = " secret ";
  assert.deepEqual(ffpfIdConfig(), {
    issuer: "https://portal.example",
    clientId: "zhuelog",
    clientSecret: "secret",
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

// The callback, with the sign-in faked: the code exchange itself is tested
// in ffpf-oidc-client.test.ts and sign-in.test.ts.
type SignInCall = [
  { code: string; verifier: string; redirectUri: string; nonce: string },
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
    `https://app.example.com/api/auth/callback/ffpf${query}`,
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

const failure = "https://app.example.com/signin?error=OAuthCallbackError";

test("a successful callback passes the cookie's verifier and nonce and sets zl_session", async () => {
  process.env.AUTH_URL = "https://zhuelog.test";
  const start = createFfpfOAuthStart("/notes?x=1");
  const { calls, previous, deps: d } = deps({ ok: true, session: issued });
  const response = await handleFfpfCallback(
    callback(`?code=code-1&state=${start.state}`, {
      zl_oauth: start.cookieValue,
      zl_session: "old-token",
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
        redirectUri: "https://zhuelog.test/api/auth/callback/ffpf",
        nonce: start.nonce,
      },
      "203.0.113.7",
    ],
  ]);
  assert.deepEqual(previous, ["old-token"]);
  const cookies = setCookies(response);
  assert.equal(cookies.length, 5);
  for (const pattern of [
    /^zl_oauth=;/,
    /^zl_session=new-session-token;.*Max-Age=2592000/i,
    /^zl_act_as=;/,
    /^zl_access=;/,
    /^zl_refresh=;/,
  ])
    assert.ok(
      cookies.some((c) => pattern.test(c)),
      String(pattern),
    );
  for (const c of cookies) {
    assert.match(c, /HttpOnly/i);
    assert.match(c, /SameSite=lax/i);
    assert.match(c, /Path=\//);
    assert.match(c, /Secure/i);
  }
});

test("the redirect URI follows the request without AUTH_URL, and an unsafe saved path falls back to /", async () => {
  delete process.env.AUTH_URL;
  const start = createFfpfOAuthStart("//evil.example/x");
  const { calls, deps: d } = deps({ ok: true, session: issued });
  const response = await handleFfpfCallback(
    callback(`?code=c&state=${start.state}`, { zl_oauth: start.cookieValue }),
    d,
  );
  assert.equal(response.headers.get("location"), "https://app.example.com/");
  assert.equal(
    calls[0]?.[0].redirectUri,
    "https://app.example.com/api/auth/callback/ffpf",
  );
});

test("a missing cookie, a state mismatch or an error parameter never signs in", async () => {
  delete process.env.AUTH_URL;
  const start = createFfpfOAuthStart("/");
  const github = createOAuthStart("/");
  const { calls, deps: d } = deps({ ok: true, session: issued });
  const oauth = { zl_oauth: start.cookieValue };
  for (const request of [
    callback(`?code=c&state=${start.state}`),
    callback(`?code=c&state=${github.state}`, { zl_oauth: github.cookieValue }),
    callback(`?code=c&state=other`, oauth),
    callback(`?code=c&state=${start.state}x`, oauth),
    callback(`?code=c&state=`, oauth),
    callback(`?state=${start.state}`, oauth),
    callback(`?error=access_denied&state=${start.state}&code=c`, oauth),
    callback(`?error=access_denied&state=${start.state}`, oauth),
  ]) {
    const response = await handleFfpfCallback(request, d);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), failure);
    assert.equal(setCookies(response).length, 1);
    assertOAuthCleared(response);
  }
  assert.equal(calls.length, 0);
});

test("every failure and error is OAuthCallbackError", async () => {
  delete process.env.AUTH_URL;
  const start = createFfpfOAuthStart("/");
  const spy = quietConsole();
  try {
    for (const result of [
      { ok: false, reason: "invalid" } as const,
      { ok: false, reason: "unavailable" } as const,
      { ok: false, reason: "throttled" } as const,
      new Error("db"),
    ]) {
      const response = await handleFfpfCallback(
        callback(`?code=c&state=${start.state}`, {
          zl_oauth: start.cookieValue,
        }),
        deps(result).deps,
      );
      assert.equal(response.headers.get("location"), failure);
      assert.ok(!setCookies(response).some((c) => /^zl_session=/.test(c)));
      assertOAuthCleared(response);
    }
  } finally {
    spy.restore();
  }
  assert.deepEqual(spy.logged, [
    ["SIGN_IN_FFPF_REFUSED", "invalid"],
    ["SIGN_IN_FFPF_REFUSED", "unavailable"],
    ["SIGN_IN_FFPF_REFUSED", "throttled"],
    ["SIGN_IN_FFPF_FAILED", "Error"],
  ]);
});

test("nothing secret is logged", async () => {
  delete process.env.AUTH_URL;
  const start = createFfpfOAuthStart("/");
  const spy = quietConsole();
  try {
    for (const result of [
      { ok: false, reason: "invalid" } as const,
      new Error(`boom code-secret ${start.nonce}`),
    ])
      await handleFfpfCallback(
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
    start.nonce,
    start.cookieValue,
    "old-token-secret",
  ])
    assert.ok(!text.includes(secret), secret);
});
