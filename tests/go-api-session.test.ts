import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GoApiError } from "../src/infrastructure/go-api/client";
import {
  goGuestFailureUrl,
  goPasswordFailureUrl,
  isSecureRequest,
} from "../src/infrastructure/go-api/go-api-session";

const path = "/logs?a=1&b=2";

test("400, 401 and 429 all lead to the one credential rejection URL", () => {
  const expected =
    "/signin?error=CredentialsSignin&callbackUrl=%2Flogs%3Fa%3D1%26b%3D2";
  assert.equal(
    goPasswordFailureUrl(new GoApiError(401, "unauthorized"), path),
    expected,
  );
  assert.equal(
    goPasswordFailureUrl(new GoApiError(429, "rate_limited"), path),
    expected,
  );
  assert.equal(
    goPasswordFailureUrl(new GoApiError(400, "bad_request"), path),
    expected,
  );
});

test("the failure URL never carries the login id or password", () => {
  const url = goPasswordFailureUrl(new GoApiError(401, "unauthorized"), "/");
  assert.equal(url, "/signin?error=CredentialsSignin&callbackUrl=%2F");
});

test("other failures are not reported as wrong credentials", () => {
  for (const error of [
    new GoApiError(500, "internal"),
    new GoApiError(503, "unavailable"),
    new GoApiError(0, "unavailable"),
    new GoApiError(403, "forbidden"),
    new Error("boom"),
    undefined,
  ])
    assert.equal(goPasswordFailureUrl(error, path), null);
});

test("any Go API failure of the guest login shows the generic message", () => {
  for (const error of [
    new GoApiError(429, "rate_limited"),
    new GoApiError(503, "unavailable"),
    new GoApiError(0, "unavailable"),
    new GoApiError(403, "forbidden"),
  ])
    assert.equal(
      goGuestFailureUrl(error, path),
      "/signin?error=Unknown&callbackUrl=%2Flogs%3Fa%3D1%26b%3D2",
    );
});

test("a guest failure that is not a GoApiError is rethrown, not redirected", () => {
  for (const error of [new Error("boom"), undefined])
    assert.equal(goGuestFailureUrl(error, path), null);
});

const originalAuthUrl = process.env.AUTH_URL;
afterEach(() => {
  if (originalAuthUrl === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = originalAuthUrl;
});

test("cookies are secure when the request came over HTTPS", () => {
  delete process.env.AUTH_URL;
  assert.equal(
    isSecureRequest(new Headers({ "x-forwarded-proto": "https" })),
    true,
  );
  assert.equal(
    isSecureRequest(new Headers({ "x-forwarded-proto": "https,http" })),
    true,
  );
  assert.equal(
    isSecureRequest(new Headers({ "x-forwarded-proto": "http" })),
    false,
  );
  assert.equal(isSecureRequest(new Headers()), false);
});

test("an https AUTH_URL makes cookies secure", () => {
  process.env.AUTH_URL = "https://example.com";
  assert.equal(isSecureRequest(new Headers()), true);
  process.env.AUTH_URL = "http://localhost:3000";
  assert.equal(isSecureRequest(new Headers()), false);
});
