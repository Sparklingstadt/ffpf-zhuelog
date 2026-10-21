import assert from "node:assert/strict";
import { test } from "node:test";
import { withUserParam } from "../src/infrastructure/go-api/authed";
import { signInPathFor } from "../src/infrastructure/go-api/current-path";

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

test("signInPathFor sends the current page back as an encoded callbackUrl", () => {
  assert.equal(
    signInPathFor("/logs/2026/10/22?user=o1"),
    "/signin?callbackUrl=%2Flogs%2F2026%2F10%2F22%3Fuser%3Do1",
  );
  assert.equal(
    signInPathFor("/logs/trash"),
    "/signin?callbackUrl=%2Flogs%2Ftrash",
  );
});

test("signInPathFor is plain /signin without a known path", () => {
  assert.equal(signInPathFor(null), "/signin");
  assert.equal(signInPathFor(undefined), "/signin");
  assert.equal(signInPathFor(""), "/signin");
});

test("signInPathFor never builds an open redirect", () => {
  for (const unsafe of [
    "//evil.test/x",
    "https://evil.test/",
    "/\\evil.test",
    "/%2F%2Fevil.test",
    "logs",
  ])
    assert.equal(signInPathFor(unsafe), "/signin?callbackUrl=%2F", unsafe);
});
