import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSessionRole } from "../src/infrastructure/auth/session-role-policy";
import { securePostgresConnectionString } from "../src/infrastructure/config/postgres-connection";
import { contentSecurityPolicy } from "../src/infrastructure/security/content-security-policy";
import {
  readLimitedBody,
  BodyLimitError,
} from "../src/infrastructure/http/read-limited-body";
import { CsvParseLearningParser } from "../src/infrastructure/csv/csv-parse-learning-parser";
import {
  CsvValidationError,
  csvImportErrorMessage,
} from "../src/domain/learning/csv-validation-error";
import { parseLogNumber } from "../src/domain/learning/value-objects/log-date";
import { getSafeCallbackPath } from "../src/presentation/http/safe-callback-path";
import { handleChatRequest } from "../src/presentation/controllers/chat-controller";

test("admin JWTs lose privileges when their login leaves the current allowlist", () => {
  assert.equal(resolveSessionRole("admin", "Alice", "alice,bob"), "admin");
  assert.equal(resolveSessionRole("admin", "Alice", "bob"), "user");
  assert.equal(resolveSessionRole("admin", "Alice", ""), "user");
  assert.equal(resolveSessionRole("admin", null, "alice"), "user");
  assert.equal(resolveSessionRole("guest", "guest", ""), "guest");
  assert.equal(resolveSessionRole("user", "alice", "alice"), "user");
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
  assert.equal(getSafeCallbackPath("/practice"), "/practice");
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

test("body reader bounds chunked input and stops stalled streams", async () => {
  await assert.rejects(
    readLimitedBody(new Response("12345"), 4),
    BodyLimitError,
  );
  const announced = new Response("", { headers: { "Content-Length": "1000" } });
  await assert.rejects(readLimitedBody(announced, 4), BodyLimitError);
  let cancelled = false;
  const stalled = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(readLimitedBody(stalled, 100, 10), /BODY_TIMEOUT/);
  assert.equal(cancelled, true);
  assert.equal(
    (await readLimitedBody(new Response("中文"), 6)).toString(),
    "中文",
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

test("chat validates origin, body and message roles before the provider and hides failures", async () => {
  let calls = 0;
  const gateway = {
    execute() {
      calls++;
      return new Response("ok");
    },
  };
  const messages = [
    { id: "1", role: "user", parts: [{ type: "text", text: "你好" }] },
  ];
  const request = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("https://app.example/api/chat", {
      method: "POST",
      headers: {
        Origin: "https://app.example",
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await handleChatRequest(
        request({ messages }, { Origin: "https://evil.example" }),
        gateway,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleChatRequest(
        request({ messages }, { "Content-Type": "text/plain" }),
        gateway,
      )
    ).status,
    415,
  );
  assert.equal(
    (
      await handleChatRequest(
        request({ payload: "x".repeat(256 * 1024) }),
        gateway,
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await handleChatRequest(
        request({ messages: [{ ...messages[0], role: "system" }] }),
        gateway,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handleChatRequest(
        request({ messages: Array(41).fill(messages[0]) }),
        gateway,
      )
    ).status,
    400,
  );
  assert.equal(calls, 0);
  assert.equal(
    (await handleChatRequest(request({ messages }), gateway)).status,
    200,
  );
  assert.equal(calls, 1);
  const failed = await handleChatRequest(request({ messages }), {
    execute() {
      throw new Error("sk-private-key");
    },
  });
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /sk-private/);
});
