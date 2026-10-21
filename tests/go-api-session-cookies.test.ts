import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCESS_COOKIE,
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
    ],
  );
});
