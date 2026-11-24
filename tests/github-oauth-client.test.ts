// Mirrors the retired services/api/auth/github_test.go (TestExchangeSuccess,
// TestExchangeUnavailable, TestExchangeTokenErrorLogOmitsSecrets,
// TestExchangeErrorsOmitSecrets) with a fake fetch; github.com is never called.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GITHUB_API_URL,
  GITHUB_TOKEN_URL,
  createGitHubOAuthClient,
} from "../src/infrastructure/auth/github-oauth-client";

const testClientId = "gh-client-id";
const testClientSecret = "gh-secret-0123456789";
const testCode = "gh-code-abcdef";
const testVerifier = "gh-verifier-0123456789abcdef";
const testRedirectUri = "https://zhuelog.example/api/auth/callback/github";
const testToken = "gho_test_token_123";
const secrets = [testClientSecret, testCode, testVerifier, testToken];

const tokenUrl = "https://gh.test/login/oauth/access_token";
const apiUrl = "https://api.gh.test";
const userUrl = `${apiUrl}/user`;

type Answer = () => Response | Promise<Response>;

const json = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
const okToken: Answer = () =>
  json(`{"access_token":"${testToken}","token_type":"bearer","scope":""}`);
const okUser: Answer = () => json(`{"id":123,"login":"Alice"}`);

function fakeGitHub(token: Answer = okToken, user: Answer = okUser) {
  const calls: { url: string; init: RequestInit }[] = [];
  const logs: [string, Record<string, string | number> | undefined][] = [];
  const fetchFn = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (url === tokenUrl) return token();
    if (url === userUrl) return user();
    throw new TypeError("unexpected url");
  }) as typeof fetch;
  const client = createGitHubOAuthClient({
    clientId: testClientId,
    clientSecret: testClientSecret,
    fetch: fetchFn,
    tokenUrl,
    apiUrl,
    log: (code, fields) => logs.push([code, fields]),
  });
  return {
    calls,
    logs,
    exchange: (code = testCode, verifier = testVerifier) =>
      client.exchange(code, verifier, testRedirectUri),
  };
}

test("the real endpoints are GitHub's", () => {
  assert.equal(GITHUB_TOKEN_URL, "https://github.com/login/oauth/access_token");
  assert.equal(GITHUB_API_URL, "https://api.github.com");
});

test("the code exchange posts the PKCE form and reads the user with the API headers", async () => {
  const f = fakeGitHub();
  assert.deepEqual(await f.exchange(), {
    ok: true,
    user: { id: 123, login: "Alice" },
  });
  assert.equal(f.calls.length, 2);

  const [token, user] = f.calls;
  assert.equal(token.url, tokenUrl);
  assert.equal(token.init.method, "POST");
  assert.equal(token.init.redirect, "manual");
  const tokenHeaders = new Headers(token.init.headers);
  assert.equal(
    tokenHeaders.get("Content-Type"),
    "application/x-www-form-urlencoded",
  );
  assert.equal(tokenHeaders.get("Accept"), "application/json");
  assert.equal(tokenHeaders.get("Authorization"), null);
  const form = new URLSearchParams(String(token.init.body));
  assert.deepEqual(Object.fromEntries(form), {
    client_id: testClientId,
    client_secret: testClientSecret,
    code: testCode,
    code_verifier: testVerifier,
    redirect_uri: testRedirectUri,
  });

  assert.equal(user.url, userUrl);
  assert.equal(user.init.method, "GET");
  assert.equal(user.init.redirect, "manual");
  assert.equal(user.init.body, undefined);
  const userHeaders = new Headers(user.init.headers);
  assert.equal(userHeaders.get("Authorization"), `Bearer ${testToken}`);
  assert.equal(userHeaders.get("Accept"), "application/vnd.github+json");
  assert.equal(userHeaders.get("X-GitHub-Api-Version"), "2022-11-28");
  assert.deepEqual(f.logs, []);
});

test("both GitHub requests name the app in User-Agent", async () => {
  // GitHub's REST API refuses requests without a User-Agent; Go's net/http
  // sent its own default, so the web names itself explicitly.
  const f = fakeGitHub();
  await f.exchange();
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) {
    assert.equal(
      new Headers(call.init.headers).get("User-Agent"),
      "ffpf-zhuelog",
      call.url,
    );
  }
});

test("a trailing slash on the API URL is dropped", async () => {
  const calls: string[] = [];
  const client = createGitHubOAuthClient({
    clientId: testClientId,
    clientSecret: testClientSecret,
    tokenUrl,
    apiUrl: `${apiUrl}/`,
    fetch: (async (input: string | URL | Request) => {
      calls.push(String(input));
      return String(input) === tokenUrl ? okToken() : okUser();
    }) as typeof fetch,
  });
  assert.equal(
    (await client.exchange(testCode, testVerifier, testRedirectUri)).ok,
    true,
  );
  assert.deepEqual(calls, [tokenUrl, userUrl]);
});

test("empty code or verifier is invalid without calling GitHub", async () => {
  const f = fakeGitHub();
  const invalid = { ok: false, reason: "invalid" };
  assert.deepEqual(await f.exchange("", testVerifier), invalid);
  assert.deepEqual(await f.exchange(testCode, ""), invalid);
  assert.equal(f.calls.length, 0);
});

test("a token error is invalid and logs only a code-shaped error", async () => {
  const f = fakeGitHub(() => json(`{"error":"bad_verification_code"}`));
  assert.deepEqual(await f.exchange(), { ok: false, reason: "invalid" });
  assert.deepEqual(f.logs, [
    ["GITHUB_TOKEN_REJECTED", { github_error: "bad_verification_code" }],
  ]);
  assert.equal(f.calls.length, 1);

  const echo = fakeGitHub(() =>
    json(JSON.stringify({ error: testClientSecret })),
  );
  assert.deepEqual(await echo.exchange(), { ok: false, reason: "invalid" });
  assert.deepEqual(echo.logs, [
    ["GITHUB_TOKEN_REJECTED", { github_error: "unrecognized" }],
  ]);
});

test("a 401 or 403 from /user is invalid", async () => {
  for (const status of [401, 403]) {
    const f = fakeGitHub(okToken, () => json(`{"message":"no"}`, status));
    assert.deepEqual(
      await f.exchange(),
      { ok: false, reason: "invalid" },
      String(status),
    );
  }
});

const unavailableCases: Record<string, [Answer, Answer]> = {
  "token endpoint 500": [() => new Response("", { status: 500 }), okUser],
  "token endpoint malformed JSON": [() => new Response("not json"), okUser],
  "token 200 without access_token or error": [() => json("{}"), okUser],
  "token endpoint unreachable": [
    () => {
      throw new TypeError("fetch failed");
    },
    okUser,
  ],
  "token endpoint redirect is not followed": [
    () =>
      new Response("", {
        status: 302,
        headers: { location: "https://elsewhere.example/" },
      }),
    okUser,
  ],
  "token access_token not a string": [
    () => json(`{"access_token":123}`),
    okUser,
  ],
  "token error not a string": [
    () => json(`{"error":1,"access_token":"${testToken}"}`),
    okUser,
  ],
  "user endpoint 500": [okToken, () => new Response("", { status: 500 })],
  "user endpoint 404": [okToken, () => new Response("", { status: 404 })],
  "user endpoint malformed JSON": [okToken, () => json(`{"id":`)],
  "user id zero": [okToken, () => json(`{"id":0,"login":"Alice"}`)],
  "user id negative": [okToken, () => json(`{"id":-5,"login":"Alice"}`)],
  "user id fractional": [okToken, () => json(`{"id":1.5,"login":"Alice"}`)],
  "user id a string": [okToken, () => json(`{"id":"123","login":"Alice"}`)],
  "user empty login": [okToken, () => json(`{"id":123,"login":""}`)],
  "user login not a string": [okToken, () => json(`{"id":123,"login":7}`)],
};

test('GitHub\'s failures are "unavailable"', async () => {
  for (const [name, [token, user]] of Object.entries(unavailableCases)) {
    const f = fakeGitHub(token, user);
    assert.deepEqual(
      await f.exchange(),
      { ok: false, reason: "unavailable" },
      name,
    );
    if (name === "token endpoint redirect is not followed") {
      assert.equal(f.calls.length, 1, name);
    }
  }
});

test("nothing secret reaches the log or the result", async () => {
  const cases: [Answer, Answer][] = [
    ...Object.values(unavailableCases),
    [() => json(JSON.stringify({ error: testClientSecret })), okUser],
    [() => json(JSON.stringify({ error: testCode })), okUser],
    [() => json(JSON.stringify({ error: testVerifier })), okUser],
    [() => json(`{"error":"bad_verification_code"}`), okUser],
    [okToken, () => json("{}", 401)],
    [okToken, okUser],
  ];
  for (const [token, user] of cases) {
    const f = fakeGitHub(token, user);
    const result = await f.exchange();
    const seen = JSON.stringify(result) + JSON.stringify(f.logs);
    for (const secret of secrets) {
      assert.equal(seen.includes(secret), false, `${secret} in ${seen}`);
    }
  }
});
