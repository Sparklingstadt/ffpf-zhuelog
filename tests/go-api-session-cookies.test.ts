import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCESS_COOKIE,
  ACT_AS_COOKIE,
  actAsCookie,
  clearedActAsCookie,
  clearedSessionCookies,
  REFRESH_COOKIE,
  sessionCookieOptions,
} from "../src/infrastructure/go-api/session-cookies";

const tokens = { accessToken: "a", refreshToken: "r", expiresIn: 900 };

test("session cookies carry the tokens with the agreed lifetimes", () => {
  const [access, refresh] = sessionCookieOptions(tokens, true);
  assert.equal(access!.name, ACCESS_COOKIE);
  assert.equal(access!.value, "a");
  assert.equal(access!.options.maxAge, 840);
  assert.equal(refresh!.name, REFRESH_COOKIE);
  assert.equal(refresh!.value, "r");
  assert.equal(refresh!.options.maxAge, 30 * 24 * 60 * 60);
  for (const c of [access!, refresh!]) {
    assert.equal(c.options.httpOnly, true);
    assert.equal(c.options.sameSite, "lax");
    assert.equal(c.options.path, "/");
    assert.equal(c.options.secure, true);
  }
});

test("the refresh cookie lives as long as the Go API says", () => {
  const [, guest] = sessionCookieOptions(
    { ...tokens, refreshExpiresIn: 24 * 60 * 60 },
    true,
  );
  assert.equal(guest!.options.maxAge, 24 * 60 * 60);
  const [, member] = sessionCookieOptions(
    { ...tokens, refreshExpiresIn: 30 * 24 * 60 * 60 },
    true,
  );
  assert.equal(member!.options.maxAge, 30 * 24 * 60 * 60);
});

test("a missing or invalid refreshExpiresIn falls back to 30 days", () => {
  for (const refreshExpiresIn of [undefined, 0, -1, Number.NaN]) {
    const [, refresh] = sessionCookieOptions(
      { ...tokens, refreshExpiresIn },
      true,
    );
    assert.equal(refresh!.options.maxAge, 30 * 24 * 60 * 60);
  }
});

test("secure follows the caller", () => {
  for (const c of sessionCookieOptions(tokens, false))
    assert.equal(c.options.secure, false);
});

test("cleared cookies expire immediately", () => {
  const cleared = clearedSessionCookies();
  assert.deepEqual(
    cleared.map((c) => [c.name, c.value, c.options.maxAge]),
    [
      [ACCESS_COOKIE, "", 0],
      [REFRESH_COOKIE, "", 0],
      [ACT_AS_COOKIE, "", 0],
    ],
  );
});

test("the act-as cookie is HttpOnly, lasts 30 days and clears to empty", () => {
  const set = actAsCookie("password:abc", true);
  assert.equal(set.name, ACT_AS_COOKIE);
  assert.equal(set.value, "password:abc");
  assert.deepEqual(set.options, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: true,
    maxAge: 30 * 24 * 60 * 60,
  });
  const cleared = clearedActAsCookie(false);
  assert.deepEqual(
    [cleared.name, cleared.value, cleared.options.maxAge],
    [ACT_AS_COOKIE, "", 0],
  );
});
