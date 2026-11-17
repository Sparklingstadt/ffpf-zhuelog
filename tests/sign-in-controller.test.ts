import assert from "node:assert/strict";
import { test } from "node:test";

import {
  demoFailureUrl,
  errorName,
  guestFailureUrl,
  oauthFailurePath,
  passwordFailureUrl,
} from "../src/presentation/controllers/sign-in-controller";

const path = "/logs?a=1";

test("invalid and throttled both lead to the one credential rejection URL", () => {
  const expected =
    "/signin?error=CredentialsSignin&callbackUrl=%2Flogs%3Fa%3D1";
  assert.equal(passwordFailureUrl("invalid", path), expected);
  assert.equal(passwordFailureUrl("throttled", path), expected);
});

test("the failure URL never carries the login id or password", () => {
  // Only the reason and the path go in: there is no parameter for the input.
  assert.equal(passwordFailureUrl.length, 2);
  const url = passwordFailureUrl("invalid", "/");
  assert.equal(url, "/signin?error=CredentialsSignin&callbackUrl=%2F");
  assert.ok(!url.includes("alice"));
});

test("any guest failure shows the generic message", () => {
  assert.equal(
    guestFailureUrl(path),
    "/signin?error=Unknown&callbackUrl=%2Flogs%3Fa%3D1",
  );
});

test("a demo that is off says so; other demo failures are generic", () => {
  assert.equal(
    demoFailureUrl("demo-unavailable", path),
    "/signin?error=DemoUnavailable&callbackUrl=%2Flogs%3Fa%3D1",
  );
  for (const reason of ["throttled", "error"] as const)
    assert.equal(
      demoFailureUrl(reason, path),
      "/signin?error=Unknown&callbackUrl=%2Flogs%3Fa%3D1",
      reason,
    );
});

test("only a forbidden GitHub sign-in is AccessDenied", () => {
  assert.equal(oauthFailurePath("forbidden"), "/signin?error=AccessDenied");
  for (const reason of [
    "invalid",
    "unavailable",
    "throttled",
    "error",
  ] as const)
    assert.equal(
      oauthFailurePath(reason),
      "/signin?error=OAuthCallbackError",
      reason,
    );
});

test("errorName gives the error's name only", () => {
  assert.equal(errorName(new TypeError("secret detail")), "TypeError");
  assert.equal(errorName("secret detail"), "string");
  assert.equal(errorName(undefined), "undefined");
});
