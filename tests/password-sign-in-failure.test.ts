import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthError, CredentialsSignin } from "next-auth";
import { passwordSignInFailureUrl } from "../src/presentation/http/password-sign-in-failure";

test("a rejected credential redirects to the signin error with an encoded callback", () => {
  assert.equal(
    passwordSignInFailureUrl(new CredentialsSignin(), "/logs?a=1&b=2"),
    "/signin?error=CredentialsSignin&callbackUrl=%2Flogs%3Fa%3D1%26b%3D2",
  );
});

// Mirrors @auth/core's CallbackRouteError, which wraps errors thrown in authorize
// (e.g. a DB outage). It is not re-exported by next-auth.
class CallbackRouteError extends AuthError {
  static type = "CallbackRouteError";
}

test("infrastructure AuthErrors are not reported as wrong credentials", () => {
  const outage = new CallbackRouteError("db down", {
    cause: new Error("db down"),
  });
  assert.ok(outage instanceof AuthError);
  assert.equal(passwordSignInFailureUrl(outage, "/"), null);
  assert.equal(passwordSignInFailureUrl(new AuthError("x"), "/"), null);
});

test("non-auth errors are not reported as wrong credentials", () => {
  assert.equal(passwordSignInFailureUrl(new Error("boom"), "/"), null);
  assert.equal(passwordSignInFailureUrl(undefined, "/"), null);
});
