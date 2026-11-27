import assert from "node:assert/strict";
import { test } from "node:test";

import {
  demoFailureReason,
  demoFailureUrl,
} from "../src/presentation/controllers/sign-in-controller";

const path = "/logs?a=1";

test("a demo that is off says so; other demo failures are generic", () => {
  assert.equal(
    demoFailureUrl("demo-unavailable", path),
    "/signin?error=DemoUnavailable&callbackUrl=%2Flogs%3Fa%3D1",
  );
  assert.equal(
    demoFailureUrl("error", path),
    "/signin?error=Unknown&callbackUrl=%2Flogs%3Fa%3D1",
  );
});

test("a refused demo sign-in means the demo account is not set up", () => {
  // Better Auth's APIError carries the HTTP status as statusCode.
  assert.equal(demoFailureReason({ statusCode: 401 }), "demo-unavailable");
  assert.equal(demoFailureReason({ statusCode: 403 }), "demo-unavailable");
  assert.equal(demoFailureReason({ statusCode: 500 }), "error");
  assert.equal(demoFailureReason(new TypeError("fetch failed")), "error");
  assert.equal(demoFailureReason(undefined), "error");
});
