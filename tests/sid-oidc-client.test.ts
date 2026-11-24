// Tests the Sparklingstadt ID OIDC client with a fake fetch and a P-256 key
// made here; the real Sparklingstadt ID is never called.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { test } from "node:test";

import {
  SID_JWKS_CACHE_MS,
  SID_LEEWAY_MS,
  createSidOidcClient,
} from "../src/infrastructure/auth/sid-oidc-client";

const issuer = "https://sid.example";
const tokenUrl = `${issuer}/oauth/token`;
const jwksUrl = `${issuer}/oauth/jwks`;
const clientId = "zhuelog";
const clientSecret = "sid-client-secret-xyz";
const redirectUri = "https://zhuelog.example/api/auth/callback/sid";
const code = "sid-code-0123456789";
const verifier = "sid-verifier-abcdefghijklmnopqrstuvwxyz0123456789";
const nonce = "sid-nonce-0123456789";
const accessToken = "sid-access-token-0123456789";
const secrets = [clientSecret, code, verifier, nonce, accessToken, "eyJ"];

const testNow = Date.parse("2026-10-27T12:00:00Z");
const seconds = (ms: number) => Math.floor(ms / 1000);

type Key = { privateKey: KeyObject; publicKey: KeyObject };
const newKey = (): Key => generateKeyPairSync("ec", { namedCurve: "P-256" });

const b64 = (data: string | Buffer) => Buffer.from(data).toString("base64url");

// header.claims signed as ES256 does: r‖s, 32 bytes each.
function signJwt(key: Key, header: object, claims: object): string {
  const input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`;
  const signature = sign("sha256", Buffer.from(input), {
    key: key.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${input}.${b64(signature)}`;
}

function signIdToken(key: Key, kid: string, claims: object): string {
  return signJwt(key, { alg: "ES256", typ: "JWT", kid }, claims);
}

function jwk(key: Key, kid: string): Record<string, unknown> {
  const { x, y } = key.publicKey.export({ format: "jwk" });
  return { kty: "EC", crv: "P-256", alg: "ES256", use: "sig", kid, x, y };
}

function claimsAt(now: number): Record<string, unknown> {
  return {
    iss: issuer,
    aud: clientId,
    sub: "cabc123",
    exp: seconds(now) + 300,
    iat: seconds(now),
    nonce,
    email: "alice@example.com",
    email_verified: true,
    name: "ふわ",
  };
}

const json = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Log = [string, Record<string, string | number> | undefined];

// Sparklingstadt ID's /oauth/token and /oauth/jwks. The token endpoint answers with
// idToken unless token is set.
function fakeSid(config: { clientId?: string; clientSecret?: string } = {}) {
  const state: {
    idToken: string;
    token?: (init: RequestInit) => Response;
    jwks: (Record<string, unknown> | null)[];
    jwksFails: boolean;
    jwksRaw?: string;
    down: boolean;
  } = { idToken: "", jwks: [], jwksFails: false, down: false };
  const tokenCalls: RequestInit[] = [];
  const jwksCalls: RequestInit[] = [];
  const logs: Log[] = [];
  let now = testNow;

  const fetchFn = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    if (state.down) throw new TypeError(`fetch failed ${url} ${clientSecret}`);
    if (url === tokenUrl) {
      tokenCalls.push(init ?? {});
      if (state.token) return state.token(init ?? {});
      return json(
        JSON.stringify({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 300,
          id_token: state.idToken,
          scope: "openid email profile",
        }),
      );
    }
    if (url === jwksUrl) {
      jwksCalls.push(init ?? {});
      if (state.jwksFails) return new Response(null, { status: 500 });
      if (state.jwksRaw !== undefined) return new Response(state.jwksRaw);
      return json(JSON.stringify({ keys: state.jwks }));
    }
    throw new TypeError("unexpected url");
  }) as typeof fetch;

  const client = createSidOidcClient({
    issuer,
    clientId: config.clientId ?? clientId,
    clientSecret: config.clientSecret ?? clientSecret,
    fetch: fetchFn,
    now: () => new Date(now),
    log: (logCode, fields) => logs.push([logCode, fields]),
  });

  return {
    state,
    tokenCalls,
    jwksCalls,
    logs,
    get now() {
      return now;
    },
    advance(ms: number) {
      now += ms;
    },
    async exchange(
      input: { code?: string; verifier?: string; nonce?: string } = {},
    ) {
      const outcome = await client.exchange(
        input.code ?? code,
        input.verifier ?? verifier,
        redirectUri,
        input.nonce ?? nonce,
      );
      assertNoSecrets(JSON.stringify([outcome, logs]));
      return outcome;
    },
  };
}

function assertNoSecrets(text: string) {
  for (const secret of secrets) {
    assert.ok(!text.includes(secret), `${text} contains ${secret}`);
  }
}

// A fake with key k1 in its JWKS and a valid ID token signed by it.
function readySid(claims?: (c: Record<string, unknown>) => void) {
  const f = fakeSid();
  const key = newKey();
  const c = claimsAt(testNow);
  claims?.(c);
  f.state.jwks = [jwk(key, "k1")];
  f.state.idToken = signIdToken(key, "k1", c);
  return { f, key };
}

const alice = { sub: "cabc123", email: "alice@example.com", name: "ふわ" };
const invalid = { ok: false, reason: "invalid" };
const unavailable = { ok: false, reason: "unavailable" };

test("the JWKS is kept 10 minutes, exp has 60 s of leeway", () => {
  assert.equal(SID_JWKS_CACHE_MS, 600_000);
  assert.equal(SID_LEEWAY_MS, 60_000);
});

test("a valid code gives the ID token's user", async () => {
  const { f } = readySid();
  assert.deepEqual(await f.exchange(), { ok: true, user: alice });
  assert.equal(f.tokenCalls.length, 1);
  assert.equal(f.jwksCalls.length, 1);
  assert.deepEqual(f.logs, []);

  const token = f.tokenCalls[0]!;
  assert.equal(token.method, "POST");
  assert.equal(token.redirect, "manual");
  const headers = new Headers(token.headers);
  assert.equal(
    headers.get("Content-Type"),
    "application/x-www-form-urlencoded",
  );
  assert.equal(headers.get("Accept"), "application/json");
  const basic = headers.get("Authorization") ?? "";
  assert.ok(basic.startsWith("Basic "), basic);
  assert.equal(
    Buffer.from(basic.slice("Basic ".length), "base64").toString(),
    `${clientId}:${clientSecret}`,
  );
  assert.deepEqual(
    [...new URLSearchParams(String(token.body))],
    [
      ["code", code],
      ["code_verifier", verifier],
      ["grant_type", "authorization_code"],
      ["redirect_uri", redirectUri],
    ],
  );

  const jwks = f.jwksCalls[0]!;
  assert.equal(jwks.method, "GET");
  assert.equal(jwks.redirect, "manual");
  assert.equal(new Headers(jwks.headers).get("Accept"), "application/json");
});

test("the Basic credentials are form-encoded first", async () => {
  const f = fakeSid({ clientId: "a b", clientSecret: "p+q:r" });
  const key = newKey();
  f.state.jwks = [jwk(key, "k1")];
  f.state.idToken = signIdToken(key, "k1", {
    ...claimsAt(testNow),
    aud: "a b",
  });
  assert.deepEqual(await f.exchange(), { ok: true, user: alice });
  const basic = new Headers(f.tokenCalls[0]!.headers).get("Authorization");
  assert.equal(
    basic,
    `Basic ${Buffer.from("a+b:p%2Bq%3Ar").toString("base64")}`,
  );
});

test("accepted ID tokens", async () => {
  const cases: [string, (c: Record<string, unknown>) => void, string][] = [
    ["exp 60 seconds ago", (c) => (c.exp = seconds(testNow) - 60), "ふわ"],
    [
      "a fractional exp 59.1 seconds ago",
      (c) => (c.exp = seconds(testNow) - 60 + 0.9),
      "ふわ",
    ],
    ["aud as an array", (c) => (c.aud = ["other", clientId]), "ふわ"],
    ["no name", (c) => delete c.name, "alice"],
    ["blank name", (c) => (c.name = "  "), "alice"],
    [
      "null claims, and unused claims of any type",
      (c) => Object.assign(c, { name: null, iat: "x", nbf: [] }),
      "alice",
    ],
    // Claim names match whatever their case.
    [
      "claim names in another case",
      (c) => {
        delete c.email_verified;
        c.EMAIL_VERIFIED = true;
      },
      "ふわ",
    ],
  ];
  for (const [name, change, display] of cases) {
    const { f } = readySid(change);
    assert.deepEqual(
      await f.exchange(),
      { ok: true, user: { ...alice, name: display } },
      name,
    );
  }
});

test("a header typ of null is no typ", async () => {
  const f = fakeSid();
  const key = newKey();
  f.state.jwks = [jwk(key, "k1")];
  f.state.idToken = signJwt(
    key,
    { alg: "ES256", typ: null, kid: "k1" },
    claimsAt(testNow),
  );
  assert.deepEqual(await f.exchange(), { ok: true, user: alice });
});

test("refused ID tokens log their reason word", async () => {
  const other = newKey();
  const withClaim =
    (name: string, value: unknown) => (_: Key, c: Record<string, unknown>) => {
      if (value === undefined) delete c[name];
      else c[name] = value;
      return undefined;
    };
  const header = (h: object) => (key: Key, c: Record<string, unknown>) =>
    signJwt(key, h, c);
  const lastDot = (token: string) => token.slice(0, token.lastIndexOf(".") + 1);
  const now = seconds(testNow);
  // Each case either changes the claims (returning undefined, the token is
  // then signed with k1) or returns the whole token.
  const cases: [
    string,
    (key: Key, c: Record<string, unknown>) => string | undefined,
    string,
  ][] = [
    ["other iss", withClaim("iss", `${issuer}/other`), "iss"],
    ["iss with a trailing slash", withClaim("iss", `${issuer}/`), "iss"],
    ["other aud", withClaim("aud", "other"), "aud"],
    ["aud array without the client", withClaim("aud", ["other"]), "aud"],
    ["no aud", withClaim("aud", undefined), "aud"],
    ["exp 61 seconds ago", withClaim("exp", now - 61), "exp"],
    ["no exp", withClaim("exp", undefined), "exp"],
    ["exp as a string", withClaim("exp", "9999999999"), "claims"],
    ["other nonce", withClaim("nonce", "other"), "nonce"],
    ["no nonce", withClaim("nonce", undefined), "nonce"],
    [
      "email_verified false",
      withClaim("email_verified", false),
      "email_verified",
    ],
    [
      "email_verified as a string",
      withClaim("email_verified", "true"),
      "email_verified",
    ],
    [
      "no email_verified",
      withClaim("email_verified", undefined),
      "email_verified",
    ],
    ["no email", withClaim("email", undefined), "email"],
    ["empty email", withClaim("email", ""), "email"],
    ["sub A/B", withClaim("sub", "A/B"), "sub"],
    ["sub with upper case", withClaim("sub", "Cabc"), "sub"],
    ["sub too long", withClaim("sub", "a".repeat(65)), "sub"],
    ["no sub", withClaim("sub", undefined), "sub"],
    [
      "signed with another key",
      (_, c) => signIdToken(other, "k1", c),
      "signature",
    ],
    [
      "alg none",
      (key, c) => lastDot(signJwt(key, { alg: "none", kid: "k1" }, c)),
      "malformed",
    ],
    ["alg none with a signature", header({ alg: "none", kid: "k1" }), "alg"],
    ["alg HS256", header({ alg: "HS256", kid: "k1" }), "alg"],
    ["typ other", header({ alg: "ES256", typ: "at+jwt", kid: "k1" }), "typ"],
    ["no kid", header({ alg: "ES256", typ: "JWT" }), "kid"],
    ["kid not in the JWKS", (key, c) => signIdToken(key, "k9", c), "kid"],
    [
      "four segments",
      (key, c) => `${signIdToken(key, "k1", c)}.x`,
      "malformed",
    ],
    [
      "padded signature",
      (key, c) => `${signIdToken(key, "k1", c)}=`,
      "malformed",
    ],
    [
      "short signature",
      (key, c) => lastDot(signIdToken(key, "k1", c)) + b64(Buffer.alloc(63)),
      "signature",
    ],
    ["not a JWT", () => "not a jwt", "malformed"],
    // Edge cases: odd values and encodings, wrong types, the order of checks.
    [
      "a fractional exp 60.1 seconds ago",
      withClaim("exp", now - 61 + 0.9),
      "exp",
    ],
    ["exp past 2^53", withClaim("exp", 2 ** 53 + 2), "exp"],
    ["negative exp", withClaim("exp", -1), "exp"],
    ["aud of one empty string", withClaim("aud", [""]), "aud"],
    ["aud array with a number", withClaim("aud", ["zhuelog", 1]), "claims"],
    ["iss as a number", withClaim("iss", 1), "claims"],
    [
      "iss and aud wrong: iss first",
      (_, c) => void Object.assign(c, { iss: "x", aud: "y", exp: 1 }),
      "iss",
    ],
    [
      "aud and exp wrong: aud first",
      (_, c) => void Object.assign(c, { aud: "y", exp: 1 }),
      "aud",
    ],
    [
      "claims not an object",
      (key) => signIdToken(key, "k1", ["x"] as unknown as object),
      "claims",
    ],
    [
      "header not an object",
      (_, c) =>
        `${b64("[1]")}.${b64(JSON.stringify(c))}.${b64(Buffer.alloc(64))}`,
      "header",
    ],
    [
      "header null and claims unreadable",
      () => `${b64("null")}.${b64("[")}.${b64(Buffer.alloc(64))}`,
      "header",
    ],
    [
      "header null",
      (_, c) =>
        `${b64("null")}.${b64(JSON.stringify(c))}.${b64(Buffer.alloc(64))}`,
      "alg",
    ],
    [
      "header with a BOM",
      (_, c) =>
        `${b64("﻿" + JSON.stringify({ alg: "ES256", kid: "k1" }))}.${b64(JSON.stringify(c))}.${b64(Buffer.alloc(64))}`,
      "header",
    ],
    [
      "header with an out-of-range number",
      (_, c) =>
        `${b64('{"alg":"ES256","kid":"k1","x":1e400}')}.${b64(JSON.stringify(c))}.${b64(Buffer.alloc(64))}`,
      "claims",
    ],
    ["kid not a string", header({ alg: "ES256", kid: 1 }), "kid"],
    ["typ not a string", header({ alg: "ES256", typ: 1, kid: "k1" }), "typ"],
    [
      "non-canonical base64url",
      (key, c) => {
        const token = signIdToken(key, "k1", c);
        // 64 bytes leave 4 unused bits in the last character; set one.
        const alphabet =
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        const last = alphabet.indexOf(token.at(-1)!);
        return token.slice(0, -1) + alphabet[last | 1];
      },
      "malformed",
    ],
  ];
  for (const [name, make, reason] of cases) {
    const f = fakeSid();
    const key = newKey();
    const c = claimsAt(testNow);
    f.state.jwks = [jwk(key, "k1")];
    f.state.idToken = make(key, c) ?? signIdToken(key, "k1", c);
    assert.deepEqual(await f.exchange(), invalid, name);
    assert.deepEqual(f.logs, [["SID_REJECTED", { reason }]], name);
  }
});

test("refused token answers", async () => {
  const cases: [string, () => Response, Record<string, string | number>][] = [
    [
      "400 invalid_grant",
      () => json(`{"error":"invalid_grant"}`, 400),
      { reason: "token_endpoint", status: 400, sid_error: "invalid_grant" },
    ],
    [
      "401 invalid_client",
      () => json(`{"error":"invalid_client"}`, 401),
      { reason: "token_endpoint", status: 401, sid_error: "invalid_client" },
    ],
    [
      "400 echoing the secret",
      () => json(`{"error":"${clientSecret}"}`, 400),
      { reason: "token_endpoint", status: 400, sid_error: "unrecognized" },
    ],
    [
      "no id_token",
      () => json(`{"access_token":"a","token_type":"Bearer"}`),
      { reason: "id_token" },
    ],
    [
      "id_token not a string",
      () => json(`{"id_token":1}`),
      { reason: "id_token" },
    ],
    ["empty id_token", () => json(`{"id_token":""}`), { reason: "id_token" }],
    ["not JSON", () => json("<html>"), { reason: "id_token" }],
  ];
  for (const [name, answer, fields] of cases) {
    const { f } = readySid();
    f.state.token = answer;
    assert.deepEqual(await f.exchange(), invalid, name);
    assert.equal(f.jwksCalls.length, 0, name);
    assert.deepEqual(f.logs, [["SID_REJECTED", fields]], name);
  }
});

test("empty code, verifier or nonce is invalid without calling", async () => {
  for (const input of [{ code: "" }, { verifier: "" }, { nonce: "" }]) {
    const { f } = readySid();
    assert.deepEqual(await f.exchange(input), invalid);
    assert.equal(f.tokenCalls.length, 0);
    assert.equal(f.jwksCalls.length, 0);
  }
});

test("unavailable answers", async () => {
  const cases: [
    string,
    (f: ReturnType<typeof fakeSid>) => void,
    Record<string, string | number>,
  ][] = [
    [
      "token 500",
      (f) => (f.state.token = () => new Response(null, { status: 500 })),
      { reason: "token_status", status: 500 },
    ],
    [
      "token 502",
      (f) => (f.state.token = () => new Response(null, { status: 502 })),
      { reason: "token_status", status: 502 },
    ],
    [
      "token 307 is not followed",
      (f) =>
        (f.state.token = () =>
          new Response(null, {
            status: 307,
            headers: { Location: "/oauth/token?moved=1" },
          })),
      { reason: "token_status", status: 307 },
    ],
    [
      "jwks 500",
      (f) => (f.state.jwksFails = true),
      { reason: "jwks_status", status: 500 },
    ],
    [
      "jwks not JSON",
      (f) => (f.state.jwksRaw = "<html>"),
      { reason: "jwks_body" },
    ],
    [
      "jwks without keys",
      (f) => (f.state.jwksRaw = "{}"),
      { reason: "jwks_body" },
    ],
    [
      "jwks keys null",
      (f) => (f.state.jwksRaw = '{"keys":null}'),
      { reason: "jwks_body" },
    ],
    [
      "jwks with a kid of the wrong type",
      (f) => (f.state.jwksRaw = '{"keys":[{"kty":"EC","kid":1}]}'),
      { reason: "jwks_body" },
    ],
    ["server down", (f) => (f.state.down = true), { reason: "transport" }],
  ];
  for (const [name, setup, fields] of cases) {
    const { f } = readySid();
    setup(f);
    assert.deepEqual(await f.exchange(), unavailable, name);
    assert.deepEqual(f.logs, [["SID_UNAVAILABLE", fields]], name);
    if (name === "token 307 is not followed") {
      assert.equal(f.tokenCalls.length, 1);
      assert.equal(f.tokenCalls[0]!.redirect, "manual");
    }
  }
});

test("a rotated key costs one refetch; an unknown kid one more, then is refused", async () => {
  const f = fakeSid();
  const [first, second, unknown] = [newKey(), newKey(), newKey()];
  f.state.jwks = [jwk(first, "k1")];
  f.state.idToken = signIdToken(first, "k1", claimsAt(testNow));
  assert.equal((await f.exchange()).ok, true);

  // Sparklingstadt ID rotates its key while the cached JWKS is still fresh.
  f.state.jwks = [jwk(second, "k2")];
  f.state.idToken = signIdToken(second, "k2", claimsAt(testNow));
  assert.deepEqual(await f.exchange(), { ok: true, user: alice });
  assert.equal(f.jwksCalls.length, 2);

  // A kid Sparklingstadt ID does not have either costs one fetch, then is refused.
  f.state.idToken = signIdToken(unknown, "k3", claimsAt(testNow));
  assert.deepEqual(await f.exchange(), invalid);
  assert.equal(f.jwksCalls.length, 3);
  assert.deepEqual(f.logs, [["SID_REJECTED", { reason: "kid" }]]);
});

test("the JWKS is kept 10 minutes, and a failed refetch is not covered by stale keys", async () => {
  const f = fakeSid();
  const key = newKey();
  f.state.jwks = [jwk(key, "k1")];
  const sign = () =>
    (f.state.idToken = signIdToken(key, "k1", claimsAt(f.now)));
  sign();
  for (let i = 0; i < 3; i += 1) assert.equal((await f.exchange()).ok, true);
  assert.equal(f.jwksCalls.length, 1);

  f.advance(599_999);
  sign();
  assert.equal((await f.exchange()).ok, true);
  assert.equal(f.jwksCalls.length, 1);

  f.advance(2);
  sign();
  assert.equal((await f.exchange()).ok, true);
  assert.equal(f.jwksCalls.length, 2);

  f.advance(600_001);
  sign();
  f.state.jwksFails = true;
  assert.deepEqual(await f.exchange(), unavailable);
  assert.equal(f.jwksCalls.length, 3);
});

test("unusable JWKs are left out", async () => {
  const f = fakeSid();
  const key = newKey();
  const offCurve = { ...jwk(key, "k1"), y: b64(Buffer.alloc(32)) };
  const encryption = { ...jwk(key, "k1"), use: "enc" };
  const { x, y } = jwk(key, "k1") as { x: string; y: string };
  f.state.jwks = [
    { kty: "RSA", kid: "k1", n: "AQAB", e: "AQAB" },
    {
      kty: "EC",
      crv: "P-384",
      kid: "k1",
      x: b64(Buffer.alloc(48)),
      y: b64(Buffer.alloc(48)),
    },
    offCurve,
    encryption,
    { ...jwk(key, "k1"), kid: "" },
    { ...jwk(key, "k1"), x: x + "A" },
    { ...jwk(key, "k1"), y: y.slice(0, -1) },
    null,
  ];
  f.state.idToken = signIdToken(key, "k1", claimsAt(testNow));
  assert.deepEqual(await f.exchange(), invalid);
  assert.deepEqual(f.logs, [["SID_REJECTED", { reason: "kid" }]]);

  const usable = jwk(key, "k1");
  delete usable.use; // use is optional
  f.state.jwks = [...f.state.jwks, usable];
  assert.deepEqual(await f.exchange(), { ok: true, user: alice });
});

test("only the first key of a kid is kept", async () => {
  const f = fakeSid();
  const [key, other] = [newKey(), newKey()];
  f.state.jwks = [jwk(other, "k1"), jwk(key, "k1")];
  f.state.idToken = signIdToken(key, "k1", claimsAt(testNow));
  assert.deepEqual(await f.exchange(), invalid);
  assert.deepEqual(f.logs, [["SID_REJECTED", { reason: "signature" }]]);
});

test("nothing secret reaches the log or the result", async () => {
  // fakeSid's exchange checks every outcome and log line; these are the
  // answers most likely to carry a secret back.
  const cases: ((f: ReturnType<typeof fakeSid>) => void)[] = [
    (f) =>
      (f.state.token = () =>
        json(
          `{"error":"${clientSecret}","error_description":"${code} ${verifier}"}`,
          400,
        )),
    (f) => (f.state.token = () => json(`{"error":"${nonce}"}`, 401)),
    (f) => (f.state.down = true),
    (f) => (f.state.token = () => json(`{"id_token":"${accessToken}"}`)),
  ];
  for (const setup of cases) {
    const { f } = readySid();
    setup(f);
    const outcome = await f.exchange();
    assert.equal(outcome.ok, false);
    assert.equal(f.logs.length, 1);
  }
});
