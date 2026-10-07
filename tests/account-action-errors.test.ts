import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { CreatePasswordAccount } from "@ffpf-zhuelog/core/application/identity/use-cases/create-password-account";
import type { PasswordHasher } from "@ffpf-zhuelog/core/application/identity/ports/password-hasher";
import type { PasswordAccountRepository } from "@ffpf-zhuelog/core/domain/identity/repositories/password-account-repository";
import {
  displayNameSchema,
  loginIdSchema,
  optionalPasswordSchema,
} from "@ffpf-zhuelog/core/domain/identity/entities/password-account";
import {
  LoginIdTakenError,
  PasswordAccountNotFoundError,
} from "@ffpf-zhuelog/core/domain/identity/password-account-error";
import { ChangeOwnPassword } from "@ffpf-zhuelog/core/application/identity/use-cases/change-own-password";
import {
  accountActionErrorMessage,
  changePasswordOutcomeMessage,
  accountActionFallbackMessage,
  isExpectedAccountActionError,
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

test("only validation and account-state errors are classified as expected", () => {
  const result = schema.safeParse({ ...valid, loginId: "A!" });
  assert.ok(!result.success);
  assert.equal(isExpectedAccountActionError(result.error), true);
  assert.equal(isExpectedAccountActionError(new LoginIdTakenError()), true);
  assert.equal(
    isExpectedAccountActionError(new PasswordAccountNotFoundError()),
    true,
  );
  assert.equal(isExpectedAccountActionError(new Error("db down")), false);
  assert.equal(isExpectedAccountActionError("boom"), false);
  assert.equal(isExpectedAccountActionError(undefined), false);
});

// Proves core's zod instance and the presenter's `instanceof ZodError` agree.
test("a ZodError thrown by the real CreatePasswordAccount is recognised", async () => {
  const unused = () => {
    throw new Error("not reached");
  };
  const repo = {
    findByLoginId: unused,
    findById: unused,
    list: unused,
    create: unused,
    reserveAttempt: unused,
    clearFailures: unused,
    setPassword: unused,
  } as unknown as PasswordAccountRepository;
  const hasher = {
    hash: unused,
    verify: unused,
    simulateVerify: unused,
    generate: () => "generated",
  } as unknown as PasswordHasher;

  const error = await new CreatePasswordAccount(repo, hasher)
    .execute({ loginId: "A!", displayName: "Alice", password: "" })
    .then(
      () => assert.fail("expected a rejection"),
      (e: unknown) => e,
    );
  assert.equal(isExpectedAccountActionError(error), true);
  assert.equal(
    accountActionErrorMessage(error),
    "ログインIDは英小文字・数字・. _ - の3〜32文字にしてください。",
  );
});

test("change-password outcomes map to their messages", () => {
  assert.equal(
    changePasswordOutcomeMessage("mismatch"),
    "確認用のパスワードが一致しません。",
  );
  assert.equal(
    changePasswordOutcomeMessage("invalid-current"),
    "現在のパスワードが違うか、一時的にロックされています。",
  );
});

test("a ZodError thrown by the real ChangeOwnPassword maps to the password message", async () => {
  const unused = () => {
    throw new Error("not reached");
  };
  const repo = {
    findById: unused,
    reserveAttempt: unused,
    setPassword: unused,
  } as unknown as PasswordAccountRepository;
  const hasher = { hash: unused, verify: unused, simulateVerify: unused };

  const error = await new ChangeOwnPassword(
    repo,
    hasher as unknown as PasswordHasher,
  )
    .execute("acc", {
      currentPassword: "current",
      newPassword: "short",
      confirmPassword: "short",
    })
    .then(
      () => assert.fail("expected a rejection"),
      (e: unknown) => e,
    );
  assert.equal(isExpectedAccountActionError(error), true);
  assert.equal(
    accountActionErrorMessage(error),
    "パスワードは12〜128文字にしてください。",
  );
});
