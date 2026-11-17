import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUTH_ROUTE_THROTTLE,
  DEMO_SIGN_IN_THROTTLE,
  PASSWORD_CHANGE_THROTTLE,
  SIGN_IN_CLIENT_THROTTLE,
  SIGN_IN_LOGIN_THROTTLE,
  authRouteThrottleKey,
  demoSignInThrottleKey,
  passwordChangeThrottleKey,
  signInClientThrottleKey,
  signInLoginThrottleKey,
} from "../src/domain/identity/sign-in-throttle";

test("throttle rules and keys are Go's", () => {
  assert.deepEqual(PASSWORD_CHANGE_THROTTLE, { limit: 5, windowMs: 900000 });
  assert.deepEqual(AUTH_ROUTE_THROTTLE, { limit: 10, windowMs: 60000 });
  assert.equal(passwordChangeThrottleKey("cacc1"), "password-change:cacc1");
  assert.equal(authRouteThrottleKey("203.0.113.7"), "route:auth:203.0.113.7");
});

test("sign-in rules and keys are Go's", () => {
  assert.deepEqual(SIGN_IN_CLIENT_THROTTLE, { limit: 20, windowMs: 900000 });
  assert.deepEqual(SIGN_IN_LOGIN_THROTTLE, { limit: 5, windowMs: 900000 });
  assert.deepEqual(DEMO_SIGN_IN_THROTTLE, { limit: 20, windowMs: 900000 });
  assert.equal(signInClientThrottleKey("203.0.113.7"), "client:203.0.113.7");
  assert.equal(
    signInLoginThrottleKey("203.0.113.7", "alice"),
    "login:203.0.113.7:alice",
  );
  assert.equal(demoSignInThrottleKey("203.0.113.7"), "demo:203.0.113.7");
});
