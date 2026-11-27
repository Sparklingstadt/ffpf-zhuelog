import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUTH_ROUTE_THROTTLE,
  PASSWORD_CHANGE_THROTTLE,
  authRouteThrottleKey,
  passwordChangeThrottleKey,
} from "../src/domain/identity/sign-in-throttle";

test("the password-change and route limits and their keys", () => {
  assert.deepEqual(PASSWORD_CHANGE_THROTTLE, { limit: 5, windowMs: 900000 });
  assert.deepEqual(AUTH_ROUTE_THROTTLE, { limit: 10, windowMs: 60000 });
  assert.equal(passwordChangeThrottleKey("cacc1"), "password-change:cacc1");
  assert.equal(authRouteThrottleKey("203.0.113.7"), "route:auth:203.0.113.7");
});
