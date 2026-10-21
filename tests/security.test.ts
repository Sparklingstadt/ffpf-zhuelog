import assert from "node:assert/strict";
import { test } from "node:test";
import { securePostgresConnectionString } from "../prisma/postgres-connection";
import { contentSecurityPolicy } from "../src/infrastructure/security/content-security-policy";
import { parseLogNumber } from "../src/domain/calendar/value-objects/log-date";
import { getSafeCallbackPath } from "../src/presentation/http/safe-callback-path";

test("callbacks reject external, encoded slash, backslash, control and malformed paths", () => {
  for (const value of [
    null,
    ["/"],
    "https://evil.example",
    "//evil.example",
    "/%2fevil.example",
    "/\\evil.example",
    "/%5cevil.example",
    "/%0a/evil.example",
    "/bad%",
    "/".repeat(2001),
  ]) {
    assert.equal(getSafeCallbackPath(value), "/");
  }
  assert.equal(
    getSafeCallbackPath("/logs/2026/9/24?view=all#note"),
    "/logs/2026/9/24?view=all#note",
  );
  assert.equal(getSafeCallbackPath("/logs"), "/logs");
});

test("remote PostgreSQL always verifies hostname and certificate without weakening local dev", () => {
  for (const params of [
    "",
    "sslmode=require",
    "sslmode=disable",
    "sslmode=verify-ca&uselibpqcompat=true&ssl=false",
  ]) {
    const url = new URL(
      securePostgresConnectionString(
        `postgresql://user:password@db.example/app?${params}`,
      ),
    );
    assert.equal(url.searchParams.get("sslmode"), "verify-full");
    assert.equal(url.searchParams.has("uselibpqcompat"), false);
    assert.equal(url.searchParams.has("ssl"), false);
  }
  assert.equal(
    new URL(
      securePostgresConnectionString("postgres://localhost:55439/test"),
    ).searchParams.has("sslmode"),
    false,
  );
  assert.throws(() => securePostgresConnectionString("invalid-secret"), {
    message: "Invalid PostgreSQL connection configuration",
  });
  assert.throws(() => securePostgresConnectionString("https://db.example"));
});

test("CSP permits only nonce scripts and same-origin connections in production", () => {
  const policy = contentSecurityPolicy("test-nonce", false, true);
  assert.match(
    policy,
    /script-src 'self' 'nonce-test-nonce' 'strict-dynamic';/,
  );
  assert.match(policy, /script-src-attr 'none'/);
  assert.match(policy, /connect-src 'self';/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /upgrade-insecure-requests/);
  assert.doesNotMatch(policy, /unsafe-eval|ws:/);
  assert.doesNotMatch(
    contentSecurityPolicy("x", true, false),
    /upgrade-insecure-requests/,
  );
});

test("log numbers outside the safe range are rejected", () => {
  assert.equal(parseLogNumber("9007199254740991"), null);
  assert.equal(parseLogNumber("2147483648"), null);
  assert.equal(parseLogNumber("1"), 1);
});
