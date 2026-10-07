import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthenticatePasswordAccount } from "@ffpf-zhuelog/core/application/identity/use-cases/authenticate-password-account";
import { ChangeOwnPassword } from "@ffpf-zhuelog/core/application/identity/use-cases/change-own-password";
import { CreatePasswordAccount } from "@ffpf-zhuelog/core/application/identity/use-cases/create-password-account";
import { ListPasswordAccounts } from "@ffpf-zhuelog/core/application/identity/use-cases/list-password-accounts";
import { ResetPasswordAccountPassword } from "@ffpf-zhuelog/core/application/identity/use-cases/reset-password-account-password";
import type { PasswordHasher } from "@ffpf-zhuelog/core/application/identity/ports/password-hasher";
import {
  LOCK_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
  type PasswordAccount,
} from "@ffpf-zhuelog/core/domain/identity/entities/password-account";
import {
  LoginIdTakenError,
  PasswordAccountNotFoundError,
} from "@ffpf-zhuelog/core/domain/identity/password-account-error";
import type { PasswordAccountRepository } from "@ffpf-zhuelog/core/domain/identity/repositories/password-account-repository";

class FakeAccounts implements PasswordAccountRepository {
  readonly accounts: PasswordAccount[] = [];
  private seq = 0;
  private tick = 0;

  private copy(account: PasswordAccount | undefined) {
    return account ? structuredClone(account) : null;
  }

  async findByLoginId(loginId: string) {
    return this.copy(this.accounts.find((a) => a.loginId === loginId));
  }
  async findById(id: string) {
    return this.copy(this.accounts.find((a) => a.id === id));
  }
  async list() {
    return structuredClone(
      [...this.accounts].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      ),
    );
  }
  async create(input: {
    loginId: string;
    displayName: string;
    passwordHash: string;
  }) {
    if (this.accounts.some((a) => a.loginId === input.loginId))
      throw new LoginIdTakenError();
    const account: PasswordAccount = {
      id: `acc-${++this.seq}`,
      ...input,
      sessionVersion: 1,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(Date.UTC(2026, 0, 1) + ++this.tick * 1000),
    };
    this.accounts.push(account);
    return account;
  }
  // Synchronous body, so it is atomic like the single UPDATE of the real one.
  async reserveAttempt(id: string, now: Date) {
    const account = this.accounts.find((a) => a.id === id)!;
    if (account.lockedUntil !== null && account.lockedUntil > now) return false;
    account.failedAttempts =
      account.lockedUntil === null ? account.failedAttempts + 1 : 1;
    account.lockedUntil =
      account.failedAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(now.getTime() + LOCK_DURATION_MS)
        : null;
    return true;
  }
  async clearFailures(id: string) {
    const account = this.accounts.find((a) => a.id === id)!;
    account.failedAttempts = 0;
    account.lockedUntil = null;
  }
  async setPassword(id: string, passwordHash: string) {
    const account = this.accounts.find((a) => a.id === id)!;
    account.passwordHash = passwordHash;
    account.sessionVersion += 1;
    account.failedAttempts = 0;
    account.lockedUntil = null;
  }
}

class FakeHasher implements PasswordHasher {
  simulated: string[] = [];
  verified: string[] = [];
  async hash(password: string) {
    return `h:${password}`;
  }
  async verify(password: string, passwordHash: string) {
    this.verified.push(password);
    await new Promise((resolve) => setTimeout(resolve, 1));
    return passwordHash === `h:${password}`;
  }
  async simulateVerify(password: string) {
    this.simulated.push(password);
  }
  generate() {
    return "generated-password-1";
  }
}

const NOW = new Date("2026-06-01T00:00:00Z");

async function setup(loginId = "taro", password = "correct horse battery") {
  const repo = new FakeAccounts();
  const hasher = new FakeHasher();
  await new CreatePasswordAccount(repo, hasher).execute({
    loginId,
    displayName: "Taro",
    password,
  });
  return { repo, hasher, account: repo.accounts[0]! };
}

test("an account created with a mixed-case padded ID authenticates with the normalized ID", async () => {
  const repo = new FakeAccounts();
  const hasher = new FakeHasher();
  await new CreatePasswordAccount(repo, hasher).execute({
    loginId: " TARO ",
    displayName: "Taro",
    password: "correct horse battery",
  });
  const account = await new AuthenticatePasswordAccount(repo, hasher).execute(
    { loginId: "taro", password: "correct horse battery" },
    NOW,
  );
  assert.equal(account?.loginId, "taro");
});

test("five wrong passwords lock the account, even against the right password, until the lock expires", async () => {
  const { repo, hasher, account } = await setup();
  const auth = new AuthenticatePasswordAccount(repo, hasher);
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++)
    assert.equal(
      await auth.execute({ loginId: "taro", password: "wrong" }, NOW),
      null,
    );
  hasher.verified.length = 0;
  hasher.simulated.length = 0;
  assert.equal(
    await auth.execute(
      { loginId: "taro", password: "correct horse battery" },
      NOW,
    ),
    null,
  );
  // Locked: no real verification, but the same hashing time is spent.
  assert.equal(hasher.verified.length, 0);
  assert.equal(hasher.simulated.length, 1);
  const ok = await auth.execute(
    { loginId: "taro", password: "correct horse battery" },
    new Date(NOW.getTime() + LOCK_DURATION_MS + 1),
  );
  assert.equal(ok?.loginId, "taro");
  assert.equal(account.failedAttempts, 0);
  assert.equal(account.lockedUntil, null);
});

test("parallel guesses cannot exceed the attempt limit and leave the account locked", async () => {
  const { repo, hasher, account } = await setup();
  const auth = new AuthenticatePasswordAccount(repo, hasher);
  const attempts = [
    ...Array.from({ length: 20 }, (_, i) =>
      auth.execute({ loginId: "taro", password: `wrong-${i}` }, NOW),
    ),
    auth.execute({ loginId: "taro", password: "correct horse battery" }, NOW),
  ];
  const results = await Promise.all(attempts);
  assert.ok(results.every((r) => r === null));
  assert.ok(hasher.verified.length <= MAX_FAILED_ATTEMPTS);
  assert.equal(hasher.simulated.length, 21 - hasher.verified.length);
  assert.ok(account.lockedUntil && account.lockedUntil > NOW);
});

test("a successful login after four failures resets the failure count", async () => {
  const { repo, hasher, account } = await setup();
  const auth = new AuthenticatePasswordAccount(repo, hasher);
  for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++)
    await auth.execute({ loginId: "taro", password: "wrong" }, NOW);
  assert.equal(account.failedAttempts, MAX_FAILED_ATTEMPTS - 1);
  assert.ok(
    await auth.execute(
      { loginId: "taro", password: "correct horse battery" },
      NOW,
    ),
  );
  assert.equal(account.failedAttempts, 0);
});

test("an unknown login ID spends a simulated verification and returns null", async () => {
  const { repo, hasher } = await setup();
  const result = await new AuthenticatePasswordAccount(repo, hasher).execute(
    { loginId: "nobody", password: "whatever" },
    NOW,
  );
  assert.equal(result, null);
  assert.deepEqual(hasher.simulated, ["whatever"]);
  assert.equal(hasher.verified.length, 0);
});

test("malformed or oversized input returns null without calling verify", async () => {
  const { repo, hasher } = await setup();
  const auth = new AuthenticatePasswordAccount(repo, hasher);
  assert.equal(
    await auth.execute({ loginId: "a b", password: "pw" }, NOW),
    null,
  );
  assert.equal(
    await auth.execute({ loginId: "taro", password: "x".repeat(129) }, NOW),
    null,
  );
  assert.equal(
    await auth.execute({ loginId: undefined, password: 1 }, NOW),
    null,
  );
  assert.equal(hasher.verified.length, 0);
  assert.equal(hasher.simulated.length, 3);
});

test("a blank password field generates one; a typed password is used as is", async () => {
  const repo = new FakeAccounts();
  const hasher = new FakeHasher();
  const create = new CreatePasswordAccount(repo, hasher);
  for (const [i, blank] of ["", " ".repeat(12)].entries()) {
    const result = await create.execute({
      loginId: `user${i}`,
      displayName: "U",
      password: blank,
    });
    assert.equal(result.generated, true);
    assert.equal(result.password, "generated-password-1");
    assert.equal(repo.accounts[i]!.passwordHash, "h:generated-password-1");
  }
  const typed = await create.execute({
    loginId: "typed",
    displayName: "U",
    password: "correct horse battery",
  });
  assert.equal(typed.generated, false);
  assert.equal(typed.password, "correct horse battery");
  assert.equal("passwordHash" in typed.account, false);
});

test("creating the same login ID twice throws LoginIdTakenError", async () => {
  const { repo, hasher } = await setup();
  await assert.rejects(
    new CreatePasswordAccount(repo, hasher).execute({
      loginId: "TARO",
      displayName: "Other",
      password: "",
    }),
    LoginIdTakenError,
  );
});

test("an invalid login ID in create throws a ZodError whose first issue path names loginId", async () => {
  const repo = new FakeAccounts();
  await assert.rejects(
    new CreatePasswordAccount(repo, new FakeHasher()).execute({
      loginId: "a b",
      displayName: "Taro",
      password: "",
    }),
    (error: unknown) => {
      const issues = (error as { issues?: { path: unknown[] }[] }).issues;
      assert.equal(issues?.[0]?.path[0], "loginId");
      return true;
    },
  );
  assert.equal(repo.accounts.length, 0);
});

test("resetting a password bumps the session version and clears the lock", async () => {
  const { repo, hasher, account } = await setup();
  account.lockedUntil = new Date(NOW.getTime() + LOCK_DURATION_MS);
  account.failedAttempts = 3;
  const before = account.sessionVersion;
  const result = await new ResetPasswordAccountPassword(repo, hasher).execute(
    account.id,
    "",
  );
  assert.deepEqual(result, {
    password: "generated-password-1",
    generated: true,
  });
  assert.equal(account.sessionVersion, before + 1);
  assert.equal(account.lockedUntil, null);
  assert.equal(account.failedAttempts, 0);
  assert.equal(account.passwordHash, "h:generated-password-1");

  const typed = await new ResetPasswordAccountPassword(repo, hasher).execute(
    account.id,
    "another long password",
  );
  assert.deepEqual(typed, {
    password: "another long password",
    generated: false,
  });
});

test("resetting an unknown account throws PasswordAccountNotFoundError", async () => {
  await assert.rejects(
    new ResetPasswordAccountPassword(
      new FakeAccounts(),
      new FakeHasher(),
    ).execute("missing", ""),
    PasswordAccountNotFoundError,
  );
});

test("changing your own password: mismatch does not count as a failure", async () => {
  const { repo, hasher, account } = await setup();
  const result = await new ChangeOwnPassword(repo, hasher).execute(
    account.id,
    {
      currentPassword: "correct horse battery",
      newPassword: "brand new password",
      confirmPassword: "different password",
    },
    NOW,
  );
  assert.equal(result, "mismatch");
  assert.equal(account.failedAttempts, 0);
  assert.equal(account.sessionVersion, 1);
});

test("changing your own password: a wrong current password is invalid-current and counts a failure", async () => {
  const { repo, hasher, account } = await setup();
  const result = await new ChangeOwnPassword(repo, hasher).execute(
    account.id,
    {
      currentPassword: "wrong",
      newPassword: "brand new password",
      confirmPassword: "brand new password",
    },
    NOW,
  );
  assert.equal(result, "invalid-current");
  assert.equal(account.failedAttempts, 1);
  assert.equal(account.passwordHash, "h:correct horse battery");
});

test("changing your own password while locked is invalid-current even with the right password", async () => {
  const { repo, hasher, account } = await setup();
  account.lockedUntil = new Date(NOW.getTime() + LOCK_DURATION_MS);
  hasher.verified.length = 0;
  hasher.simulated.length = 0;
  const result = await new ChangeOwnPassword(repo, hasher).execute(
    account.id,
    {
      currentPassword: "correct horse battery",
      newPassword: "brand new password",
      confirmPassword: "brand new password",
    },
    NOW,
  );
  assert.equal(result, "invalid-current");
  assert.equal(hasher.verified.length, 0);
  assert.equal(hasher.simulated.length, 1);
});

test("changing your own password succeeds and bumps the session version", async () => {
  const { repo, hasher, account } = await setup();
  const result = await new ChangeOwnPassword(repo, hasher).execute(
    account.id,
    {
      currentPassword: "correct horse battery",
      newPassword: "brand new password",
      confirmPassword: "brand new password",
    },
    NOW,
  );
  assert.equal(result, "changed");
  assert.equal(account.sessionVersion, 2);
  assert.equal(account.passwordHash, "h:brand new password");
});

test("a too-short new password throws a ZodError naming newPassword", async () => {
  const { repo, hasher, account } = await setup();
  await assert.rejects(
    new ChangeOwnPassword(repo, hasher).execute(
      account.id,
      {
        currentPassword: "correct horse battery",
        newPassword: "short",
        confirmPassword: "short",
      },
      NOW,
    ),
    (error: unknown) => {
      const issues = (error as { issues?: { path: unknown[] }[] }).issues;
      assert.equal(issues?.[0]?.path[0], "newPassword");
      return true;
    },
  );
});

test("listing returns summaries without hashes, oldest first, flagging locked accounts", async () => {
  const { repo, hasher } = await setup("first");
  await new CreatePasswordAccount(repo, hasher).execute({
    loginId: "second",
    displayName: "Second",
    password: "",
  });
  repo.accounts[0]!.lockedUntil = new Date(NOW.getTime() + LOCK_DURATION_MS);
  const list = await new ListPasswordAccounts(repo).execute(NOW);
  assert.deepEqual(
    list.map((a) => [a.loginId, a.locked]),
    [
      ["first", true],
      ["second", false],
    ],
  );
  for (const item of list) {
    assert.equal("passwordHash" in item, false);
    assert.equal("failedAttempts" in item, false);
  }
});
