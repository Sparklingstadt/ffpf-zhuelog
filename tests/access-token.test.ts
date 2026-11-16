import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { verifyAccessToken } from "../src/infrastructure/identity/access-token";

const SECRET = "0123456789abcdef0123456789abcdef"; // 32 bytes
const NOW = new Date("2026-11-16T00:00:00Z");
const IAT = Math.floor(NOW.getTime() / 1000) - 60;

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Builds an HS256-signed JWT the way the Go signer does.
function sign(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  secret: string,
): string {
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

const HS256 = { alg: "HS256", typ: "JWT" };

function base(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: "10001",
    role: "admin",
    login: "octocat",
    iss: "ffpf-zhuelog-api",
    aud: ["ffpf-zhuelog-mobile"],
    iat: IAT,
    exp: IAT + 900,
    ...extra,
  };
}

function without(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const copy = { ...payload };
  delete copy[key];
  return copy;
}

function verify(token: string) {
  return verifyAccessToken(token, SECRET, NOW);
}

test("an admin token yields the owner id and login", () => {
  assert.deepEqual(verify(sign(HS256, base(), SECRET)), {
    role: "admin",
    ownerId: "10001",
    login: "octocat",
  });
});

test("a member token yields the session version", () => {
  const payload = without(
    base({ sub: "password:abc", role: "member", sv: 3 }),
    "login",
  );
  assert.deepEqual(verify(sign(HS256, payload, SECRET)), {
    role: "member",
    ownerId: "password:abc",
    sessionVersion: 3,
  });
});

test("aud as a plain string is accepted", () => {
  const payload = base({ aud: "ffpf-zhuelog-mobile" });
  assert.deepEqual(verify(sign(HS256, payload, SECRET)), {
    role: "admin",
    ownerId: "10001",
    login: "octocat",
  });
});

test("aud as an array is accepted when any element matches", () => {
  const payload = base({ aud: ["other", "ffpf-zhuelog-mobile"] });
  assert.notEqual(verify(sign(HS256, payload, SECRET)), null);
});

test("a guest token must have sub guest", () => {
  const guest = without(base({ sub: "guest", role: "guest" }), "login");
  assert.deepEqual(verify(sign(HS256, guest, SECRET)), {
    role: "guest",
    ownerId: "guest",
  });
  assert.equal(verify(sign(HS256, { ...guest, sub: "x" }, SECRET)), null);
});

test("rejects every invalid token", () => {
  const member = without(
    base({ sub: "password:abc", role: "member", sv: 3 }),
    "login",
  );
  const exp = IAT + 900;
  const nowSec = Math.floor(NOW.getTime() / 1000);
  const cases: Record<string, string> = {
    "exp equals now": sign(HS256, base({ exp: nowSec }), SECRET),
    "exp before now": sign(HS256, base({ exp: nowSec - 1 }), SECRET),
    "exp missing": sign(HS256, without(base(), "exp"), SECRET),
    "iat missing": sign(HS256, without(base(), "iat"), SECRET),
    "iat in the future": sign(HS256, base({ iat: nowSec + 1, exp }), SECRET),
    "other secret": sign(HS256, base(), "f".repeat(32)),
    "alg none": `${b64({ alg: "none", typ: "JWT" })}.${b64(base())}.`,
    "alg HS512": sign({ alg: "HS512", typ: "JWT" }, base(), SECRET),
    "wrong iss": sign(HS256, base({ iss: "someone" }), SECRET),
    "wrong aud": sign(HS256, base({ aud: ["other"] }), SECRET),
    "empty sub": sign(HS256, base({ sub: "" }), SECRET),
    "admin without login": sign(HS256, without(base(), "login"), SECRET),
    "member with negative sv": sign(HS256, { ...member, sv: -1 }, SECRET),
    "member with fractional sv": sign(HS256, { ...member, sv: 1.5 }, SECRET),
    "member without sv": sign(HS256, without(member, "sv"), SECRET),
    "unknown role": sign(HS256, base({ role: "owner" }), SECRET),
  };
  for (const [name, token] of Object.entries(cases))
    assert.equal(verify(token), null, name);
});

test("a short secret rejects every token", () => {
  const short = "s".repeat(31);
  const token = sign(HS256, base(), short);
  assert.equal(verifyAccessToken(token, short, NOW), null);
});

test("malformed input is null, not a throw", () => {
  const valid = sign(HS256, base(), SECRET);
  const [h, p] = valid.split(".");
  for (const token of [
    "",
    "a.b",
    "a.b.c.d",
    "!!!.???.***",
    `${h}.${p}`,
    `${h}.${p}.not base64url!`,
    `${b64("x")}.${b64("y")}.sig`,
  ])
    assert.equal(verify(token), null, token);
});
