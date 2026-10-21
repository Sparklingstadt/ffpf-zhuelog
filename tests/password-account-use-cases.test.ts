import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthenticatePasswordAccount } from "../src/application/identity/use-cases/authenticate-password-account";
import type { PasswordHasher } from "../src/application/identity/ports/password-hasher";
import type { SignInThrottle } from "../src/application/identity/ports/sign-in-throttle";
import {
  MAX_ATTEMPTS_PER_CLIENT,
  MAX_FAILURES_PER_LOGIN,
  THROTTLE_WINDOW_MS,
  type PasswordAccount,
} from "../src/domain/identity/entities/password-account";
import { LoginIdTakenError } from "../src/domain/identity/password-account-error";
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
  await repo.create({
    loginId,
    displayName: "Taro",
    passwordHash: await hasher.hash(password),
  });
  return {
    repo,
    hasher,
    throttle,
    auth: new AuthenticatePasswordAccount(repo, hasher, throttle),
    account: repo.accounts[0]!,
  };
}

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
