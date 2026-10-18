import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSessionRole } from "../src/infrastructure/auth/session-role-policy";
import { securePostgresConnectionString } from "../src/infrastructure/config/postgres-connection";
import { contentSecurityPolicy } from "../src/infrastructure/security/content-security-policy";
import { CsvParseLearningParser } from "../src/infrastructure/csv/csv-parse-learning-parser";
import {
  CsvValidationError,
  csvImportErrorMessage,
} from "../src/domain/learning/csv-validation-error";
import { parseLogNumber } from "../src/domain/calendar/value-objects/log-date";
import { getSafeCallbackPath } from "../src/presentation/http/safe-callback-path";

test("admin JWTs lose privileges when their login leaves the current allowlist", () => {
  assert.equal(resolveSessionRole("admin", "Alice", "alice,bob"), "admin");
  assert.equal(resolveSessionRole("admin", "Alice", "bob"), "revoked");
  assert.equal(resolveSessionRole("admin", "Alice", ""), "revoked");
  assert.equal(resolveSessionRole("admin", null, "alice"), "revoked");
  assert.equal(resolveSessionRole("guest", "guest", ""), "guest");
  assert.equal(resolveSessionRole("member", "taro", ""), "member");
  assert.equal(resolveSessionRole("revoked", "alice", "alice"), "revoked");
});

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

test("CSV limits records, fields and hints; unexpected database errors are redacted", () => {
  const parser = new CsvParseLearningParser();
  for (const source of [
    Array(1001).fill("中,文,pin").join("\n"),
    `中,文,pin,${Array(101).fill("hint").join(",")}`,
    `${"中".repeat(10_001)},文,pin`,
    `"${"a".repeat(100_001)}",文,pin`,
  ]) {
    assert.throws(() => parser.parse(source), CsvValidationError);
  }
  assert.equal(
    parser.parse(`中,文,pin,${Array(100).fill("hint").join(",")}`)[0].hints
      .length,
    100,
  );
  assert.doesNotMatch(
    csvImportErrorMessage(new Error("postgres://secret@host SQL")),
    /secret|postgres|SQL/,
  );
  assert.equal(
    csvImportErrorMessage(new CsvValidationError("3列未満")),
    "3列未満",
  );
  assert.equal(parseLogNumber("9007199254740991"), null);
  assert.equal(parseLogNumber("2147483648"), null);
  assert.equal(parseLogNumber("1"), 1);
});
