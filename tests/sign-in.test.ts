// Mirrors services/api/auth/login_test.go (password and guest) and
// services/api/auth/demo_test.go.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSignIn,
  type SignInDeps,
} from "../src/application/identity/sign-in";
import type { SessionPrincipal } from "../src/domain/identity/session";
import type { ThrottleRule } from "../src/domain/identity/sign-in-throttle";

const client = "203.0.113.7";
const otherClient = "198.51.100.9";
const start = new Date("2026-11-17T03:00:00.000Z").getTime();

type Account = { id: string; passwordHash: string; sessionVersion: number };

function codePoints(s: string) {
  return [...s].length;
}

function fixture({
  accounts = { alice: account("cacc1", "pw", 0) },
  demoLoginId,
}: {
  accounts?: Record<string, Account>;
  demoLoginId?: string;
} = {}) {
  let t = start;
  const counts = new Map<string, { count: number; since: number }>();
  const consumed: string[] = [];
  const resets: string[] = [];
  const lookups: string[] = [];
  const hashed: string[] = [];
  const started: SessionPrincipal[] = [];
  const deps: SignInDeps = {
    throttle: {
      async consume(key: string, rule: ThrottleRule, now: Date) {
        consumed.push(key);
        const entry = counts.get(key);
        if (!entry || now.getTime() - entry.since >= rule.windowMs) {
          counts.set(key, { count: 1, since: now.getTime() });
          return 1 <= rule.limit;
        }
        entry.count += 1;
        return entry.count <= rule.limit;
      },
      async reset(key: string) {
        resets.push(key);
        counts.delete(key);
      },
    },
    passwordAccounts: {
      async findByLoginId(loginId: string) {
        lookups.push(loginId);
        return accounts[loginId] ?? null;
      },
    },
    ffpfAccounts: {
      async upsert() {
        throw new Error("not in this test");
      },
    },
    passwords: {
      async verify(password: string, hash: string) {
        hashed.push(password);
        return hash === `hash:${password}`;
      },
      async simulate(password: string) {
        hashed.push(password);
      },
    },
    sessions: {
      async start(principal: SessionPrincipal) {
        started.push(principal);
        return `token-${started.length}`;
      },
    },
    github: null,
    ffpf: null,
    allowedGitHubIds: new Set(),
    demoLoginId,
    now: () => new Date(t),
  };
  return {
    deps,
    signIn: createSignIn(deps),
    consumed,
    resets,
    lookups,
    hashed,
    started,
    count: (key: string) => counts.get(key)?.count ?? 0,
    advance(ms: number) {
      t += ms;
    },
  };
}

function account(id: string, password: string, sessionVersion: number) {
  return { id, passwordHash: `hash:${password}`, sessionVersion };
}

const withoutRoute = (keys: string[]) =>
  keys.filter((key) => !key.startsWith("route:auth:"));

test("every sign-in first counts route:auth:<client>, 10 a minute", async () => {
  const f = fixture();
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await f.signIn.asGuest(client)).ok, true, `attempt ${i}`);
  }
  assert.deepEqual(await f.signIn.asGuest(client), {
    ok: false,
    reason: "throttled",
  });
  assert.equal(f.started.length, 10);
  assert.equal(f.consumed[0], `route:auth:${client}`);
  f.advance(61_000);
  assert.equal((await f.signIn.asGuest(client)).ok, true);
});

test("every sign-in, the OAuth ones too, is refused by the route limit", async () => {
  const f = fixture({ demoLoginId: "demo" });
  for (let i = 0; i < 10; i += 1) await f.signIn.asGuest(client);
  const throttled = { ok: false, reason: "throttled" };
  assert.deepEqual(
    await f.signIn.withPassword({ loginId: "alice", password: "pw" }, client),
    throttled,
  );
  assert.deepEqual(await f.signIn.asDemo(client), throttled);
  assert.deepEqual(
    await f.signIn.withGitHub(
      { code: "c", verifier: "v", redirectUri: "https://x/cb" },
      client,
    ),
    throttled,
  );
  assert.deepEqual(
    await f.signIn.withFfpf(
      { code: "c", verifier: "v", redirectUri: "https://x/cb", nonce: "n" },
      client,
    ),
    throttled,
  );
  assert.deepEqual(withoutRoute(f.consumed), []);
  assert.deepEqual(f.lookups, []);
  assert.deepEqual(f.hashed, []);
});

test("a password member signs in with the account's sessionVersion", async () => {
  const f = fixture({ accounts: { alice: account("cacc1", "pw", 3) } });
  const result = await f.signIn.withPassword(
    { loginId: "alice", password: "pw" },
    client,
  );
  assert.deepEqual(result, {
    ok: true,
    session: { token: "token-1", maxAgeSeconds: 2592000 },
  });
  assert.deepEqual(f.started, [
    { role: "member", ownerId: "password:cacc1", sessionVersion: 3 },
  ]);
  assert.deepEqual(f.resets, ["login:203.0.113.7:alice"]);
  assert.deepEqual(f.consumed, [
    "route:auth:203.0.113.7",
    "client:203.0.113.7",
    "login:203.0.113.7:alice",
  ]);
  assert.deepEqual(f.hashed, ["pw"]);
});

test("the loginId is trimmed and lowercased like JavaScript", async () => {
  for (const [loginId, lookups] of [
    ["  Alice ", ["alice"]],
    ["﻿alice", ["alice"]],
    ["\u0085alice", []],
    ["İabc", []],
    ["Kabc", ["kabc"]],
  ] as const) {
    const f = fixture({
      accounts: {
        alice: account("cacc1", "pw", 0),
        iabc: account("cacc2", "pw", 0),
        kabc: account("cacc3", "pw", 0),
      },
    });
    const result = await f.signIn.withPassword(
      { loginId, password: "pw" },
      client,
    );
    assert.equal(result.ok, lookups.length > 0, JSON.stringify(loginId));
    assert.deepEqual(f.lookups, lookups, JSON.stringify(loginId));
  }
});

test('every credential failure is "invalid" after exactly one hash', async () => {
  const malformed = [
    { name: "short id", loginId: "a", password: "pw" },
    { name: "space in id", loginId: "al ice", password: "pw" },
    { name: "33 characters", loginId: "a".repeat(33), password: "pw" },
    { name: "empty password", loginId: "alice", password: "" },
    { name: "129 runes", loginId: "alice", password: "x".repeat(129) },
    {
      name: "129 multibyte runes",
      loginId: "alice",
      password: "パ".repeat(129),
    },
  ];
  const looked = [
    { name: "unknown id", loginId: "nobody", password: "pw" },
    { name: "wrong password", loginId: "alice", password: "wrong" },
  ];
  for (const [cases, lookup] of [
    [malformed, false],
    [looked, true],
  ] as const) {
    for (const { name, loginId, password } of cases) {
      const f = fixture();
      assert.deepEqual(
        await f.signIn.withPassword({ loginId, password }, client),
        { ok: false, reason: "invalid" },
        name,
      );
      assert.equal(f.hashed.length, 1, name);
      assert.ok(codePoints(f.hashed[0]) <= 128, name);
      assert.deepEqual(f.resets, [], name);
      assert.deepEqual(f.started, [], name);
      assert.deepEqual(
        withoutRoute(f.consumed),
        lookup
          ? ["client:203.0.113.7", `login:203.0.113.7:${loginId}`]
          : ["client:203.0.113.7"],
        name,
      );
      assert.deepEqual(f.lookups, lookup ? [loginId] : [], name);
    }
  }
});

test("the 21st attempt from one client is throttled before hashing", async () => {
  const f = fixture();
  for (let i = 0; i < 20; i += 1) {
    const loginId = i % 4 === 3 ? "x" : `user${i}`;
    assert.deepEqual(
      await f.signIn.withPassword({ loginId, password: "wrong" }, client),
      { ok: false, reason: "invalid" },
      `attempt ${i}`,
    );
    f.advance(7_000);
  }
  const hashes = f.hashed.length;
  const lookups = f.lookups.length;
  assert.deepEqual(
    await f.signIn.withPassword({ loginId: "alice", password: "pw" }, client),
    { ok: false, reason: "throttled" },
  );
  assert.equal(f.hashed.length, hashes);
  assert.equal(f.lookups.length, lookups);
  assert.equal(f.consumed.at(-1), "client:203.0.113.7");

  const other = await f.signIn.withPassword(
    { loginId: "alice", password: "pw" },
    otherClient,
  );
  assert.equal(other.ok, true);

  f.advance(15 * 60 * 1000);
  const later = await f.signIn.withPassword(
    { loginId: "alice", password: "pw" },
    client,
  );
  assert.equal(later.ok, true);
});

test("the 6th attempt on a loginId is throttled; other clients and loginIds are not", async () => {
  const f = fixture({
    accounts: {
      alice: account("cacc1", "pw", 0),
      bob: account("cacc2", "pw", 0),
    },
  });
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(
      await f.signIn.withPassword({ loginId: "alice", password: "no" }, client),
      { ok: false, reason: "invalid" },
    );
  }
  const hashes = f.hashed.length;
  assert.deepEqual(
    await f.signIn.withPassword({ loginId: " ALICE ", password: "pw" }, client),
    { ok: false, reason: "throttled" },
  );
  assert.equal(f.hashed.length, hashes);
  assert.equal(
    (
      await f.signIn.withPassword(
        { loginId: "alice", password: "pw" },
        otherClient,
      )
    ).ok,
    true,
  );
  assert.deepEqual(
    await f.signIn.withPassword({ loginId: "bob", password: "no" }, client),
    { ok: false, reason: "invalid" },
  );
  f.advance(15 * 60 * 1000);
  assert.equal(
    (await f.signIn.withPassword({ loginId: "alice", password: "pw" }, client))
      .ok,
    true,
  );
});

test("success resets the login count, not the client count", async () => {
  const f = fixture();
  for (let i = 0; i < 4; i += 1) {
    await f.signIn.withPassword({ loginId: "alice", password: "no" }, client);
    f.advance(7_000);
  }
  assert.equal(
    (await f.signIn.withPassword({ loginId: "alice", password: "pw" }, client))
      .ok,
    true,
  );
  f.advance(7_000);
  assert.equal(f.count("login:203.0.113.7:alice"), 0);
  assert.equal(f.count("client:203.0.113.7"), 5);
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(
      await f.signIn.withPassword({ loginId: "alice", password: "no" }, client),
      { ok: false, reason: "invalid" },
      `attempt ${i}`,
    );
    f.advance(7_000);
  }
  assert.deepEqual(
    await f.signIn.withPassword({ loginId: "alice", password: "pw" }, client),
    { ok: false, reason: "throttled" },
  );
});

test("an unknown loginId is counted like a known one", async () => {
  const f = fixture();
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(
      await f.signIn.withPassword(
        { loginId: "nobody", password: "pw" },
        client,
      ),
      { ok: false, reason: "invalid" },
    );
  }
  assert.equal(f.hashed.length, 5);
  assert.deepEqual(
    await f.signIn.withPassword({ loginId: "nobody", password: "pw" }, client),
    { ok: false, reason: "throttled" },
  );
  assert.equal(f.hashed.length, 5);
  assert.equal(f.count("client:203.0.113.7"), 6);
  assert.equal(f.count("login:203.0.113.7:nobody"), 6);
});

test('store and hasher errors are thrown, not "invalid"', async () => {
  const lookupFails = fixture();
  lookupFails.deps.passwordAccounts.findByLoginId = async () => {
    throw new Error("db");
  };
  await assert.rejects(
    createSignIn(lookupFails.deps).withPassword(
      { loginId: "alice", password: "pw" },
      client,
    ),
    { message: "db" },
  );

  const hashFails = fixture();
  hashFails.deps.passwords.verify = async () => {
    throw new Error("hash");
  };
  await assert.rejects(
    createSignIn(hashFails.deps).withPassword(
      { loginId: "alice", password: "pw" },
      client,
    ),
    { message: "hash" },
  );
  assert.deepEqual(hashFails.resets, []);
});

test('a guest shares the owner id "guest" for 24 hours', async () => {
  const f = fixture();
  assert.deepEqual(await f.signIn.asGuest(client), {
    ok: true,
    session: { token: "token-1", maxAgeSeconds: 86400 },
  });
  assert.deepEqual(f.started, [{ role: "guest", ownerId: "guest" }]);
  assert.deepEqual(f.consumed, ["route:auth:203.0.113.7"]);
  assert.deepEqual(f.lookups, []);
});

test("no DEMO_LOGIN_ID is demo-unavailable without counting the demo key", async () => {
  const f = fixture();
  assert.deepEqual(await f.signIn.asDemo(client), {
    ok: false,
    reason: "demo-unavailable",
  });
  assert.deepEqual(f.consumed, ["route:auth:203.0.113.7"]);
  assert.deepEqual(f.lookups, []);
});

const demoAccount = {
  id: "cdemo",
  passwordHash: "demo:no-password",
  sessionVersion: 0,
};

test("the demo signs in to the reset's account with its sessionVersion", async () => {
  const f = fixture({ accounts: { demo: demoAccount }, demoLoginId: "demo" });
  assert.deepEqual(await f.signIn.asDemo(client), {
    ok: true,
    session: { token: "token-1", maxAgeSeconds: 2592000 },
  });
  assert.deepEqual(f.started, [
    { role: "member", ownerId: "password:cdemo", sessionVersion: 0 },
  ]);
  assert.deepEqual(f.consumed, ["route:auth:203.0.113.7", "demo:203.0.113.7"]);
  assert.deepEqual(f.lookups, ["demo"]);
  assert.deepEqual(f.hashed, []);
});

test("a missing demo account or a real password is demo-unavailable", async () => {
  for (const accounts of [
    {} as Record<string, Account>,
    {
      demo: {
        id: "cdemo",
        passwordHash: "scrypt:32768:8:1:AAAA:BBBB",
        sessionVersion: 0,
      },
    },
  ]) {
    const f = fixture({ accounts, demoLoginId: "demo" });
    assert.deepEqual(await f.signIn.asDemo(client), {
      ok: false,
      reason: "demo-unavailable",
    });
    assert.deepEqual(f.started, []);
    assert.deepEqual(f.hashed, []);
  }
});

test("the 21st demo sign-in from one client is throttled", async () => {
  const f = fixture({ accounts: { demo: demoAccount }, demoLoginId: "demo" });
  for (let i = 0; i < 20; i += 1) {
    assert.equal((await f.signIn.asDemo(client)).ok, true, `attempt ${i}`);
    f.advance(7_000);
  }
  assert.deepEqual(await f.signIn.asDemo(client), {
    ok: false,
    reason: "throttled",
  });
  assert.equal(f.consumed.at(-1), "demo:203.0.113.7");
  assert.equal((await f.signIn.asDemo(otherClient)).ok, true);
});

test("GitHub and FFPF ID are unavailable until their clients exist", async () => {
  const f = fixture();
  assert.deepEqual(
    await f.signIn.withGitHub(
      { code: "c", verifier: "v", redirectUri: "https://x/cb" },
      client,
    ),
    { ok: false, reason: "unavailable" },
  );
  assert.deepEqual(
    await f.signIn.withFfpf(
      { code: "c", verifier: "v", redirectUri: "https://x/cb", nonce: "n" },
      client,
    ),
    { ok: false, reason: "unavailable" },
  );
  assert.deepEqual(f.consumed, [
    "route:auth:203.0.113.7",
    "route:auth:203.0.113.7",
  ]);
});
