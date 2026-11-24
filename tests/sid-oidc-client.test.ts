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
    ["exp 59 seconds ago", (c) => (c.exp = seconds(testNow) - 59), "ふわ"],
    [
      "a fractional exp 59.1 seconds ago",
      (c) => (c.exp = seconds(testNow) - 60 + 0.9),
      "ふわ",
    ],
    ["nbf 59 seconds ahead", (c) => (c.nbf = seconds(testNow) + 59), "ふわ"],
    ["no iat", (c) => delete c.iat, "ふわ"],
    ["aud as an array", (c) => (c.aud = ["other", clientId]), "ふわ"],
    ["no name", (c) => delete c.name, "alice"],
    ["blank name", (c) => (c.name = "  "), "alice"],
    ["null name", (c) => (c.name = null), "alice"],
    ["a name that is not a string", (c) => (c.name = 1), "alice"],
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

test("a header without typ is accepted", async () => {
  const f = fakeSid();
  const key = newKey();
  f.state.jwks = [jwk(key, "k1")];
  f.state.idToken = signJwt(
    key,
    { alg: "ES256", kid: "k1" },
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
  const raw = (headerJson: string, claimsJson: string) =>
    `${b64(headerJson)}.${b64(claimsJson)}.${b64(Buffer.alloc(64))}`;
  const lastDot = (token: string) => token.slice(0, token.lastIndexOf(".") + 1);
  const now = seconds(testNow);
  // Each case either changes the claims (returning undefined, the token is
  // then signed with k1) or returns the whole token. The JWKS holds k1 only.
  const cases: [
    string,
    (key: Key, c: Record<string, unknown>) => string | undefined,
    string,
  ][] = [
    // The signature and the algorithm.
    [
      "signed with another key",
      (_, c) => signIdToken(other, "k1", c),
      "signature",
    ],
    [
      "claims changed after signing",
      (key, c) => {
        const [h, , s] = signIdToken(key, "k1", c).split(".");
        return `${h}.${b64(JSON.stringify({ ...c, sub: "mallory" }))}.${s}`;
      },
      "signature",
    ],
    [
      "short signature",
      (key, c) => lastDot(signIdToken(key, "k1", c)) + b64(Buffer.alloc(63)),
      "signature",
    ],
    [
      "alg none without a signature",
      (key, c) => lastDot(signJwt(key, { alg: "none", kid: "k1" }, c)),
      "alg",
    ],
    ["alg none with a signature", header({ alg: "none", kid: "k1" }), "alg"],
    ["alg HS256", header({ alg: "HS256", kid: "k1" }), "alg"],
    ["alg RS256", header({ alg: "RS256", kid: "k1" }), "alg"],
    ["alg ES384", header({ alg: "ES384", kid: "k1" }), "alg"],
    ["no alg", header({ typ: "JWT", kid: "k1" }), "malformed"],
    // The key. The JWKS has one key, which jose alone would use for a token
    // that names no kid.
    ["no kid", header({ alg: "ES256", typ: "JWT" }), "kid"],
    ["empty kid", header({ alg: "ES256", kid: "" }), "kid"],
    ["kid not a string", header({ alg: "ES256", kid: 1 }), "kid"],
    ["kid not in the JWKS", (key, c) => signIdToken(key, "k9", c), "kid"],
    // The header.
    ["typ other", header({ alg: "ES256", typ: "at+jwt", kid: "k1" }), "typ"],
    ["typ not a string", header({ alg: "ES256", typ: 1, kid: "k1" }), "typ"],
    ["typ null", header({ alg: "ES256", typ: null, kid: "k1" }), "typ"],
    [
      "an unknown critical header",
      header({ alg: "ES256", kid: "k1", crit: ["x"], x: 1 }),
      "unverifiable",
    ],
    // The shape of the token.
    ["not a JWT", () => "not a jwt", "malformed"],
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
      "header not an object",
      (_, c) => raw("[1]", JSON.stringify(c)),
      "malformed",
    ],
    ["header null", (_, c) => raw("null", JSON.stringify(c)), "malformed"],
    [
      "claims not an object",
      (key) => signIdToken(key, "k1", ["x"] as unknown as object),
      "malformed",
    ],
    // iss, aud and the times.
    ["other iss", withClaim("iss", `${issuer}/other`), "iss"],
    ["iss with a trailing slash", withClaim("iss", `${issuer}/`), "iss"],
    ["iss as a number", withClaim("iss", 1), "iss"],
    ["no iss", withClaim("iss", undefined), "iss"],
    ["other aud", withClaim("aud", "other"), "aud"],
    ["aud array without the client", withClaim("aud", ["other"]), "aud"],
    ["aud of one empty string", withClaim("aud", [""]), "aud"],
    ["no aud", withClaim("aud", undefined), "aud"],
    ["exp 60 seconds ago", withClaim("exp", now - 60), "exp"],
    ["exp 61 seconds ago", withClaim("exp", now - 61), "exp"],
    [
      "a fractional exp 60.1 seconds ago",
      withClaim("exp", now - 61 + 0.9),
      "exp",
    ],
    ["negative exp", withClaim("exp", -1), "exp"],
    ["no exp", withClaim("exp", undefined), "exp"],
    ["exp as a string", withClaim("exp", "9999999999"), "exp"],
    ["nbf 61 seconds ahead", withClaim("nbf", now + 61), "nbf"],
    ["nbf not a number", withClaim("nbf", "x"), "nbf"],
    ["iat not a number", withClaim("iat", "x"), "iat"],
    // The claims checked after jose.
    ["other nonce", withClaim("nonce", "other"), "nonce"],
    ["no nonce", withClaim("nonce", undefined), "nonce"],
    ["nonce as a number", withClaim("nonce", 1), "nonce"],
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
    [
      "email_verified under a name in another case",
      (_, c) => {
        delete c.email_verified;
        c.EMAIL_VERIFIED = true;
        return undefined;
      },
      "email_verified",
    ],
    ["no email", withClaim("email", undefined), "email"],
    ["empty email", withClaim("email", ""), "email"],
    ["email as a number", withClaim("email", 1), "email"],
    ["sub A/B", withClaim("sub", "A/B"), "sub"],
    ["sub with upper case", withClaim("sub", "Cabc"), "sub"],
    ["sub too long", withClaim("sub", "a".repeat(65)), "sub"],
    ["sub as a number", withClaim("sub", 1), "sub"],
    ["no sub", withClaim("sub", undefined), "sub"],
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

test("a token of another alg is refused before any key is fetched", async () => {
  for (const alg of ["none", "HS256", "RS256"]) {
    const f = fakeSid();
    const key = newKey();
    f.state.jwks = [jwk(key, "k1")];
    f.state.idToken = signJwt(key, { alg, kid: "k1" }, claimsAt(testNow));
    assert.deepEqual(await f.exchange(), invalid, alg);
    assert.equal(f.jwksCalls.length, 0, alg);
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
      "jwks keys not an array",
      (f) => (f.state.jwksRaw = '{"keys":{}}'),
      { reason: "jwks_body" },
    ],
    [
      "jwks with an entry that is not an object",
      (f) => (f.state.jwksRaw = '{"keys":[null]}'),
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

test("a JWK that cannot verify ES256 is not used", async () => {
  const key = newKey();
  const good = jwk(key, "k1");
  // Each is the JWKS's only key of kid k1.
  const cases: [string, Record<string, unknown>, string][] = [
    ["RSA", { kty: "RSA", kid: "k1", n: "AQAB", e: "AQAB" }, "kid"],
    [
      "P-384",
      {
        kty: "EC",
        crv: "P-384",
        kid: "k1",
        x: b64(Buffer.alloc(48)),
        y: b64(Buffer.alloc(48)),
      },
      "kid",
    ],
    ["for encryption", { ...good, use: "enc" }, "kid"],
    ["for another alg", { ...good, alg: "ES384" }, "kid"],
    ["not for verifying", { ...good, key_ops: ["sign"] }, "kid"],
    ["empty kid", { ...good, kid: "" }, "kid"],
    [
      "a point off the curve",
      { ...good, y: b64(Buffer.alloc(32)) },
      "unverifiable",
    ],
    [
      "a coordinate of the wrong length",
      { ...good, x: `${String(good.x)}A` },
      "unverifiable",
    ],
    [
      "a private key",
      { ...good, d: key.privateKey.export({ format: "jwk" }).d },
      "unverifiable",
    ],
  ];
  for (const [name, unusable, reason] of cases) {
    const f = fakeSid();
    f.state.jwks = [unusable];
    f.state.idToken = signIdToken(key, "k1", claimsAt(testNow));
    assert.deepEqual(await f.exchange(), invalid, name);
    assert.deepEqual(f.logs, [["SID_REJECTED", { reason }]], name);
  }

  // Keys of other kids are passed over, and use is optional.
  const f = fakeSid();
  const usable = { ...good };
  delete usable.use;
  f.state.jwks = [
    { kty: "RSA", kid: "k0", n: "AQAB", e: "AQAB" },
    { ...jwk(newKey(), "k2"), use: "enc" },
    usable,
  ];
  f.state.idToken = signIdToken(key, "k1", claimsAt(testNow));
  assert.deepEqual(await f.exchange(), { ok: true, user: alice });
});

test("two keys of one kid are refused", async () => {
  const f = fakeSid();
  const [key, other] = [newKey(), newKey()];
  f.state.jwks = [jwk(key, "k1"), jwk(other, "k1")];
  f.state.idToken = signIdToken(key, "k1", claimsAt(testNow));
  assert.deepEqual(await f.exchange(), invalid);
  assert.deepEqual(f.logs, [["SID_REJECTED", { reason: "kid" }]]);
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
