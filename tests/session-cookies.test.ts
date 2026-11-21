import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACT_AS_COOKIE,
  ACT_AS_MAX_AGE,
  actAsCookieWrite,
  clearedActAsCookieWrite,
  cookieWrite,
  LEGACY_SESSION_COOKIES,
  OAUTH_COOKIE,
  SESSION_COOKIE,
  signedInCookieWrites,
  signedOutCookieWrites,
} from "../src/infrastructure/auth/session-cookies";

const attributes = (secure: boolean) => ({
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure,
});

test("the cookie names stay the ones the browser already has", () => {
  assert.equal(SESSION_COOKIE, "zl_session");
  assert.equal(ACT_AS_COOKIE, "zl_act_as");
  assert.equal(OAUTH_COOKIE, "zl_oauth");
  assert.deepEqual(LEGACY_SESSION_COOKIES, ["zl_access", "zl_refresh"]);
});

test("a signed-in browser gets zl_session and loses the act-as and Go cookies", () => {
  const token = "T".repeat(43);
  assert.deepEqual(
    signedInCookieWrites({ token, maxAgeSeconds: 2_592_000 }, true),
    [
      {
        name: "zl_session",
        value: token,
        options: { ...attributes(true), maxAge: 2_592_000 },
      },
      {
        name: "zl_act_as",
        value: "",
        options: { ...attributes(true), maxAge: 0 },
      },
      {
        name: "zl_access",
        value: "",
        options: { ...attributes(true), maxAge: 0 },
      },
      {
        name: "zl_refresh",
        value: "",
        options: { ...attributes(true), maxAge: 0 },
      },
    ],
  );
});

test("a guest's cookie lasts 24 hours", () => {
  const [session] = signedInCookieWrites(
    { token: "G".repeat(43), maxAgeSeconds: 86_400 },
    false,
  );
  assert.deepEqual(session, {
    name: "zl_session",
    value: "G".repeat(43),
    options: { ...attributes(false), maxAge: 86_400 },
  });
});

test("signing out clears all four", () => {
  assert.deepEqual(
    signedOutCookieWrites(true),
    ["zl_session", "zl_act_as", "zl_access", "zl_refresh"].map((name) => ({
      name,
      value: "",
      options: { ...attributes(true), maxAge: 0 },
    })),
  );
  for (const write of signedOutCookieWrites(false))
    assert.equal(write.options.secure, false);
});

test("the act-as cookie lives 30 days", () => {
  assert.equal(ACT_AS_MAX_AGE, 2_592_000);
  assert.deepEqual(actAsCookieWrite("password:abc", true), {
    name: "zl_act_as",
    value: "password:abc",
    options: { ...attributes(true), maxAge: 2_592_000 },
  });
  assert.deepEqual(clearedActAsCookieWrite(false), {
    name: "zl_act_as",
    value: "",
    options: { ...attributes(false), maxAge: 0 },
  });
});

test("cookieWrite carries the shared attributes", () => {
  assert.deepEqual(cookieWrite("zl_oauth", "v", 600, true), {
    name: "zl_oauth",
    value: "v",
    options: { ...attributes(true), maxAge: 600 },
  });
});
