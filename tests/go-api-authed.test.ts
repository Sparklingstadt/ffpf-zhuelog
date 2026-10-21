import assert from "node:assert/strict";
import { test } from "node:test";
import { withUserParam } from "../src/infrastructure/go-api/authed";

test("withUserParam leaves the path alone without an owner", () => {
  assert.equal(withUserParam("/v1/log-dates", undefined), "/v1/log-dates");
});

test("withUserParam appends an encoded user parameter", () => {
  assert.equal(
    withUserParam("/v1/log-dates", "a b&c"),
    "/v1/log-dates?user=a%20b%26c",
  );
  assert.equal(
    withUserParam("/v1/entries?limit=100", "o1"),
    "/v1/entries?limit=100&user=o1",
  );
});
