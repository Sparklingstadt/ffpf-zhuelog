import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  displayNameSchema,
  loginIdSchema,
  optionalPasswordSchema,
} from "@ffpf-zhuelog/core/domain/identity/entities/password-account";
import {
  LoginIdTakenError,
  PasswordAccountNotFoundError,
} from "@ffpf-zhuelog/core/domain/identity/password-account-error";
import {
  accountActionErrorMessage,
  accountActionFallbackMessage,
} from "../src/presentation/presenters/account-action-errors";

const schema = z.object({
  loginId: loginIdSchema,
  displayName: displayNameSchema,
  password: optionalPasswordSchema,
});
const valid = { loginId: "alice", displayName: "Alice", password: "" };

function messageFor(input: Record<string, unknown>) {
  const result = schema.safeParse({ ...valid, ...input });
  assert.ok(!result.success);
  return accountActionErrorMessage(result.error);
}

test("a ZodError is mapped by the offending field", () => {
  assert.equal(
    messageFor({ loginId: "A!" }),
    "ログインIDは英小文字・数字・. _ - の3〜32文字にしてください。",
  );
  assert.equal(
    messageFor({ displayName: "  " }),
    "表示名は1〜50文字にしてください。",
  );
  assert.equal(
    messageFor({ password: "short" }),
    "パスワードは12〜128文字にしてください。",
  );
});

test("the first failing field wins when several are invalid", () => {
  assert.equal(
    messageFor({ loginId: "", displayName: "", password: "x" }),
    "ログインIDは英小文字・数字・. _ - の3〜32文字にしてください。",
  );
});

test("a ZodError for a password-only schema maps to the password message", () => {
  const result = z
    .object({ password: optionalPasswordSchema })
    .safeParse({ password: "x".repeat(129) });
  assert.ok(!result.success);
  assert.equal(
    accountActionErrorMessage(result.error),
    "パスワードは12〜128文字にしてください。",
  );
});

test("a ZodError for an unknown field falls back to the generic message", () => {
  const result = z.object({ other: z.string() }).safeParse({});
  assert.ok(!result.success);
  assert.equal(
    accountActionErrorMessage(result.error),
    accountActionFallbackMessage,
  );
});

test("domain errors are mapped", () => {
  assert.equal(
    accountActionErrorMessage(new LoginIdTakenError()),
    "このログインIDはすでに使われています。",
  );
  assert.equal(
    accountActionErrorMessage(new PasswordAccountNotFoundError()),
    "アカウントが見つかりません。",
  );
});

test("unknown errors get a generic message without leaking details", () => {
  const message = accountActionErrorMessage(
    new Error("connect ECONNREFUSED secret-host:5432"),
  );
  assert.equal(message, accountActionFallbackMessage);
  assert.ok(!message.includes("secret-host"));
  assert.equal(accountActionErrorMessage("boom"), accountActionFallbackMessage);
  assert.equal(
    accountActionErrorMessage(undefined),
    accountActionFallbackMessage,
  );
});
