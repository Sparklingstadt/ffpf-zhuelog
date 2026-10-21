import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthenticatePasswordAccount } from "../src/application/identity/use-cases/authenticate-password-account";
import { ChangeOwnPassword } from "../src/application/identity/use-cases/change-own-password";
import { CreatePasswordAccount } from "../src/application/identity/use-cases/create-password-account";
import { ListPasswordAccounts } from "../src/application/identity/use-cases/list-password-accounts";
import { ResetPasswordAccountPassword } from "../src/application/identity/use-cases/reset-password-account-password";
import type { PasswordHasher } from "../src/application/identity/ports/password-hasher";
import type { SignInThrottle } from "../src/application/identity/ports/sign-in-throttle";
import {
  MAX_ATTEMPTS_PER_CLIENT,
  MAX_FAILURES_PER_LOGIN,
  THROTTLE_WINDOW_MS,
  type PasswordAccount,
} from "../src/domain/identity/entities/password-account";
import {
  LoginIdTakenError,
  PasswordAccountNotFoundError,
} from "../src/domain/identity/password-account-error";
import type { PasswordAccountRepository } from "../src/domain/identity/repositories/password-account-repository";

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
      createdAt: new Date(Date.UTC(2026, 0, 1) + ++this.tick * 1000),
    };
    this.accounts.push(account);
    return account;
  }
  async setPassword(id: string, passwordHash: string) {
    const account = this.accounts.find((a) => a.id === id)!;
    account.passwordHash = passwordHash;
    account.sessionVersion += 1;
  }
}

class FakeThrottle implements SignInThrottle {
  readonly counters = new Map<string, { count: number; expiresAt: Date }>();
  // Synchronous body, so it is atomic like the single upsert of the real one.
  async consume(key: string, limit: number, windowMs: number, now: Date) {
    const current = this.counters.get(key);
    const next =
      current && current.expiresAt > now
        ? { ...current, count: current.count + 1 }
        : { count: 1, expiresAt: new Date(now.getTime() + windowMs) };
    this.counters.set(key, next);
    return next.count <= limit;
  }
  async reset(key: string) {
    this.counters.delete(key);
  }
  count(key: string) {
    return this.counters.get(key)?.count ?? 0;
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

const CLIENT = "203.0.113.7";
const OTHER_CLIENT = "198.51.100.9";

async function setup(loginId = "taro", password = "correct horse battery") {
  const repo = new FakeAccounts();
  const hasher = new FakeHasher();
  const throttle = new FakeThrottle();
  await new CreatePasswordAccount(repo, hasher).execute({
    loginId,
    displayName: "Taro",
    password,
  });
  return {
    repo,
    hasher,
    throttle,
    auth: new AuthenticatePasswordAccount(repo, hasher, throttle),
    account: repo.accounts[0]!,
  };
}

test("an account created with a mixed-case padded ID authenticates with the normalized ID", async () => {
  const repo = new FakeAccounts();
  const hasher = new FakeHasher();
  await new CreatePasswordAccount(repo, hasher).execute({
    loginId: " TARO ",
    displayName: "Taro",
    password: "correct horse battery",
  });
  const account = await new AuthenticatePasswordAccount(
    repo,
    hasher,
    new FakeThrottle(),
  ).execute(
    { loginId: "taro", password: "correct horse battery", client: CLIENT },
    NOW,
  );
  assert.equal(account?.loginId, "taro");
});

test("five wrong passwords pause that login ID for that client only, until the window ends", async () => {
  const { auth, hasher } = await setup();
  for (let i = 0; i < MAX_FAILURES_PER_LOGIN; i++)
    assert.equal(
      await auth.execute(
        { loginId: "taro", password: "wrong", client: CLIENT },
        NOW,
      ),
      null,
    );
  hasher.verified.length = 0;
  assert.equal(
    await auth.execute(
      { loginId: "taro", password: "correct horse battery", client: CLIENT },
      NOW,
    ),
    null,
  );
  // Paused: no hashing at all, so the pause also caps the hashing cost.
  assert.equal(hasher.verified.length, 0);

  // Someone else's failures never lock the member out from their own client.
  const fromElsewhere = await auth.execute(
    {
      loginId: "taro",
      password: "correct horse battery",
      client: OTHER_CLIENT,
    },
    NOW,
  );
  assert.equal(fromElsewhere?.loginId, "taro");

  const later = await auth.execute(
    { loginId: "taro", password: "correct horse battery", client: CLIENT },
    new Date(NOW.getTime() + THROTTLE_WINDOW_MS + 1),
  );
  assert.equal(later?.loginId, "taro");
});

test("one client gets a fixed number of attempts across all login IDs, refused before hashing", async () => {
  const { auth, hasher, throttle } = await setup();
  for (let i = 0; i < MAX_ATTEMPTS_PER_CLIENT; i++)
    await auth.execute(
      { loginId: `user${i}`, password: "wrong", client: CLIENT },
      NOW,
    );
  hasher.simulated.length = 0;
  hasher.verified.length = 0;
  assert.equal(
    await auth.execute(
      { loginId: "taro", password: "correct horse battery", client: CLIENT },
      NOW,
    ),
    null,
  );
  assert.equal(hasher.simulated.length + hasher.verified.length, 0);
  // Refused before the login ID is even looked at.
  assert.equal(throttle.count(`login:${CLIENT}:taro`), 0);
});

test("parallel guesses from one client cannot exceed the per-login limit", async () => {
  const { auth, hasher } = await setup();
  const attempts = [
    ...Array.from({ length: 12 }, (_, i) =>
      auth.execute(
        { loginId: "taro", password: `wrong-${i}`, client: CLIENT },
        NOW,
      ),
    ),
    auth.execute(
      { loginId: "taro", password: "correct horse battery", client: CLIENT },
      NOW,
    ),
  ];
  const results = await Promise.all(attempts);
  assert.ok(results.filter((r) => r !== null).length <= 1);
  assert.ok(hasher.verified.length <= MAX_FAILURES_PER_LOGIN);
});

test("a successful login after four failures resets that login's count", async () => {
  const { auth, throttle } = await setup();
  const key = `login:${CLIENT}:taro`;
  for (let i = 0; i < MAX_FAILURES_PER_LOGIN - 1; i++)
    await auth.execute(
      { loginId: "taro", password: "wrong", client: CLIENT },
      NOW,
    );
  assert.equal(throttle.count(key), MAX_FAILURES_PER_LOGIN - 1);
  assert.ok(
    await auth.execute(
      { loginId: "taro", password: "correct horse battery", client: CLIENT },
      NOW,
    ),
  );
  assert.equal(throttle.count(key), 0);
  // The client-wide count is not reset by a success.
  assert.equal(throttle.count(`client:${CLIENT}`), MAX_FAILURES_PER_LOGIN);
});

test("an unknown login ID spends a simulated verification, counts like a real one, and returns null", async () => {
  const { auth, hasher, throttle } = await setup();
  const result = await auth.execute(
    { loginId: "Nobody", password: "whatever", client: CLIENT },
    NOW,
  );
  assert.equal(result, null);
  assert.deepEqual(hasher.simulated, ["whatever"]);
  assert.equal(hasher.verified.length, 0);
  assert.equal(throttle.count(`login:${CLIENT}:nobody`), 1);
});

test("malformed or oversized input returns null without calling verify", async () => {
  const { auth, hasher, throttle } = await setup();
  assert.equal(
    await auth.execute({ loginId: "a b", password: "pw", client: CLIENT }, NOW),
    null,
  );
  assert.equal(
    await auth.execute(
      { loginId: "taro", password: "x".repeat(129), client: CLIENT },
      NOW,
    ),
    null,
  );
  assert.equal(
    await auth.execute(
      { loginId: undefined, password: 1, client: CLIENT },
      NOW,
    ),
    null,
  );
  assert.equal(hasher.verified.length, 0);
  assert.equal(hasher.simulated.length, 3);
  assert.equal(throttle.count(`client:${CLIENT}`), 3);
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

test("resetting a password bumps the session version", async () => {
  const { repo, hasher, account } = await setup();
  const before = account.sessionVersion;
  const result = await new ResetPasswordAccountPassword(repo, hasher).execute(
    account.id,
    "",
  );
  assert.deepEqual(result, {
    loginId: account.loginId,
    password: "generated-password-1",
    generated: true,
  });
  assert.equal(account.sessionVersion, before + 1);
  assert.equal(account.passwordHash, "h:generated-password-1");

  const typed = await new ResetPasswordAccountPassword(repo, hasher).execute(
    account.id,
    "another long password",
  );
  assert.deepEqual(typed, {
    loginId: account.loginId,
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
  const { repo, hasher, throttle, account } = await setup();
  const result = await new ChangeOwnPassword(repo, hasher, throttle).execute(
    account.id,
    {
      currentPassword: "correct horse battery",
      newPassword: "brand new password",
      confirmPassword: "different password",
    },
    NOW,
  );
  assert.equal(result, "mismatch");
  assert.equal(throttle.count(`password-change:${account.id}`), 0);
  assert.equal(account.sessionVersion, 1);
});

test("changing your own password: a wrong current password is invalid-current and counts a failure", async () => {
  const { repo, hasher, throttle, account } = await setup();
  const result = await new ChangeOwnPassword(repo, hasher, throttle).execute(
    account.id,
    {
      currentPassword: "wrong",
      newPassword: "brand new password",
      confirmPassword: "brand new password",
    },
    NOW,
  );
  assert.equal(result, "invalid-current");
  assert.equal(throttle.count(`password-change:${account.id}`), 1);
  // Never counted against sign-in.
  assert.equal(
    [...throttle.counters.keys()].some((key) => key.startsWith("login:")),
    false,
  );
  assert.equal(account.passwordHash, "h:correct horse battery");
});

test("changing your own password after five wrong tries is invalid-current even with the right password", async () => {
  const { repo, hasher, throttle, account } = await setup();
  const change = new ChangeOwnPassword(repo, hasher, throttle);
  const input = (currentPassword: string) => ({
    currentPassword,
    newPassword: "brand new password",
    confirmPassword: "brand new password",
  });
  for (let i = 0; i < MAX_FAILURES_PER_LOGIN; i++)
    await change.execute(account.id, input("wrong"), NOW);
  hasher.verified.length = 0;
  hasher.simulated.length = 0;
  const result = await change.execute(
    account.id,
    input("correct horse battery"),
    NOW,
  );
  assert.equal(result, "invalid-current");
  assert.equal(hasher.verified.length, 0);
  assert.equal(hasher.simulated.length, 1);
});

test("changing your own password succeeds, bumps the session version and resets the count", async () => {
  const { repo, hasher, throttle, account } = await setup();
  const change = new ChangeOwnPassword(repo, hasher, throttle);
  await change.execute(
    account.id,
    {
      currentPassword: "wrong",
      newPassword: "brand new password",
      confirmPassword: "brand new password",
    },
    NOW,
  );
  const result = await change.execute(
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
  assert.equal(throttle.count(`password-change:${account.id}`), 0);
});

test("a too-short new password throws a ZodError naming newPassword", async () => {
  const { repo, hasher, throttle, account } = await setup();
  await assert.rejects(
    new ChangeOwnPassword(repo, hasher, throttle).execute(
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

test("listing returns summaries without hashes, oldest first", async () => {
  const { repo, hasher } = await setup("first");
  await new CreatePasswordAccount(repo, hasher).execute({
    loginId: "second",
    displayName: "Second",
    password: "",
  });
  const list = await new ListPasswordAccounts(repo).execute();
  assert.deepEqual(
    list.map((a) => a.loginId),
    ["first", "second"],
  );
  for (const item of list) assert.equal("passwordHash" in item, false);
});
