import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";
import { sidConfig } from "../src/infrastructure/config/environment";
import type {
  IssuedSession,
  SignInResult,
} from "../src/application/identity/sign-in";
import {
  createSidOAuthStart,
  SID_CALLBACK_PATH,
  sidAuthorizeUrl,
  parseSidOAuthCookie,
  sidRedirectUri,
} from "../src/infrastructure/auth/sid-oauth";
import {
  createOAuthStart,
  parseOAuthCookie,
} from "../src/infrastructure/auth/github-oauth";
import { signedInCookieWrites } from "../src/infrastructure/auth/session-cookies";
import { handleSidCallback } from "../src/presentation/http/sid-callback";

const originalEnv = {
  AUTH_URL: process.env.AUTH_URL,
  SID_ISSUER: process.env.SID_ISSUER,
  SID_CLIENT_ID: process.env.SID_CLIENT_ID,
  SID_CLIENT_SECRET: process.env.SID_CLIENT_SECRET,
};
afterEach(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("the redirect URI is the Sparklingstadt ID callback path on the origin", () => {
  assert.equal(SID_CALLBACK_PATH, "/api/auth/callback/sid");
  assert.equal(
    sidRedirectUri("https://example.com"),
    "https://example.com/api/auth/callback/sid",
  );
});

test("the authorize URL asks the issuer for openid email profile with PKCE and a nonce", () => {
  const url = new URL(
    sidAuthorizeUrl({
      issuer: "https://portal.example",
      clientId: "zhuelog",
      redirectUri: "https://example.com/api/auth/callback/sid",
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
    "https://example.com/api/auth/callback/sid",
  );
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("state"), "state-1");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-1");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("nonce"), "nonce-1");
});

test("a Sparklingstadt ID start has fresh random values, an S256 challenge and a nonce", () => {
  const a = createSidOAuthStart("/logs");
  const b = createSidOAuthStart("/logs");
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

test("the Sparklingstadt ID cookie value round-trips", () => {
  const start = createSidOAuthStart("/logs?a=1");
  assert.deepEqual(parseSidOAuthCookie(start.cookieValue), {
    state: start.state,
    verifier: start.verifier,
    nonce: start.nonce,
    callbackPath: "/logs?a=1",
    provider: "sid",
  });
});

test("a GitHub cookie never parses as Sparklingstadt ID, and a Sparklingstadt ID cookie never as GitHub", () => {
  assert.equal(parseSidOAuthCookie(createOAuthStart("/").cookieValue), null);
  assert.equal(parseOAuthCookie(createSidOAuthStart("/").cookieValue), null);
});

test("a missing or broken Sparklingstadt ID cookie value is null", () => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const valid = {
    provider: "sid",
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
    assert.equal(parseSidOAuthCookie(value), null, String(value));
});

test("sidConfig needs the issuer, the client id and the secret", () => {
  process.env.SID_ISSUER = " https://portal.example/ ";
  process.env.SID_CLIENT_ID = " zhuelog ";
  process.env.SID_CLIENT_SECRET = " secret ";
  assert.deepEqual(sidConfig(), {
    issuer: "https://portal.example",
    clientId: "zhuelog",
    clientSecret: "secret",
  });
  process.env.SID_ISSUER = "http://127.0.0.1:3100";
  assert.equal(sidConfig()?.issuer, "http://127.0.0.1:3100");

  for (const issuer of [
    "",
    "http://portal.example",
    "javascript:alert(1)",
    "portal.example",
  ]) {
    process.env.SID_ISSUER = issuer;
    assert.equal(sidConfig(), undefined, issuer);
  }
  process.env.SID_ISSUER = "https://portal.example";
  process.env.SID_CLIENT_ID = "";
  assert.equal(sidConfig(), undefined);
  delete process.env.SID_CLIENT_ID;
  assert.equal(sidConfig(), undefined);
});

// The callback, with the sign-in faked: the code exchange itself is tested
// in sid-oidc-client.test.ts and sign-in.test.ts.
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
    `https://app.example.com/api/auth/callback/sid${query}`,
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
  const start = createSidOAuthStart("/notes?x=1");
  const { calls, previous, deps: d } = deps({ ok: true, session: issued });
  const response = await handleSidCallback(
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
        redirectUri: "https://zhuelog.test/api/auth/callback/sid",
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
  const start = createSidOAuthStart("//evil.example/x");
  const { calls, deps: d } = deps({ ok: true, session: issued });
  const response = await handleSidCallback(
    callback(`?code=c&state=${start.state}`, { zl_oauth: start.cookieValue }),
    d,
  );
  assert.equal(response.headers.get("location"), "https://app.example.com/");
  assert.equal(
    calls[0]?.[0].redirectUri,
    "https://app.example.com/api/auth/callback/sid",
  );
});

test("a missing cookie, a state mismatch or an error parameter never signs in", async () => {
  delete process.env.AUTH_URL;
  const start = createSidOAuthStart("/");
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
    const response = await handleSidCallback(request, d);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), failure);
    assert.equal(setCookies(response).length, 1);
    assertOAuthCleared(response);
  }
  assert.equal(calls.length, 0);
});

test("every failure and error is OAuthCallbackError", async () => {
  delete process.env.AUTH_URL;
  const start = createSidOAuthStart("/");
  const spy = quietConsole();
  try {
    for (const result of [
      { ok: false, reason: "invalid" } as const,
      { ok: false, reason: "unavailable" } as const,
      { ok: false, reason: "throttled" } as const,
      new Error("db"),
    ]) {
      const response = await handleSidCallback(
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
    ["SIGN_IN_SID_REFUSED", "invalid"],
    ["SIGN_IN_SID_REFUSED", "unavailable"],
    ["SIGN_IN_SID_REFUSED", "throttled"],
    ["SIGN_IN_SID_FAILED", "Error"],
  ]);
});

test("nothing secret is logged", async () => {
  delete process.env.AUTH_URL;
  const start = createSidOAuthStart("/");
  const spy = quietConsole();
  try {
    for (const result of [
      { ok: false, reason: "invalid" } as const,
      new Error(`boom code-secret ${start.nonce}`),
    ])
      await handleSidCallback(
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

test("the sid cookie value carries provider sid, and a ffpf one is refused", () => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const valid = {
    state: "s",
    verifier: "v",
    nonce: "n",
    callbackPath: "/",
  };
  assert.deepEqual(parseSidOAuthCookie(encode({ ...valid, provider: "sid" })), {
    ...valid,
    provider: "sid",
  });
  assert.equal(
    parseSidOAuthCookie(encode({ ...valid, provider: "ffpf" })),
    null,
  );
});

test("sidRedirectUri points at the sid callback", () => {
  assert.equal(
    sidRedirectUri("https://x.example"),
    "https://x.example/api/auth/callback/sid",
  );
});
