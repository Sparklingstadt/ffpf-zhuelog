// Mirrors services/api/auth/password_change_test.go.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOwnPassword,
  type OwnPasswordDeps,
} from "../src/application/identity/own-password";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";

const member: AuthenticatedUser = {
  githubLogin: "alice",
  githubId: "password:cacc1",
  role: "member",
  accountId: "cacc1",
};
const admin: AuthenticatedUser = {
  githubLogin: "octocat",
  githubId: "10001",
  role: "admin",
};
const actingAdmin: AuthenticatedUser = {
  githubLogin: "octocat",
  githubId: "password:cacc1",
  role: "admin",
  accountId: "cacc1",
  actingAs: {
    ownerId: "password:cacc1",
    loginId: "alice",
    displayName: "Alice",
  },
  actorId: "10001",
};
const ffpfMember: AuthenticatedUser = {
  githubLogin: "f@example.com",
  githubId: "ffpf:cabc",
  role: "member",
};
const demo: AuthenticatedUser = { ...member, demo: true };
const guest: AuthenticatedUser = { githubLogin: "g", role: "guest" };
const revoked: AuthenticatedUser = { ...member, role: "revoked" };
const noAccountId: AuthenticatedUser = {
  githubLogin: "alice",
  githubId: "password:cacc1",
  role: "member",
};

const now = new Date("2026-11-17T03:00:00.000Z");
const client = "203.0.113.7";
const routeKey = "route:auth:203.0.113.7";
const changeKey = "password-change:cacc1";
const routeRule = { limit: 10, windowMs: 60_000 };
const changeRule = { limit: 5, windowMs: 900_000 };

function fakeDeps(
  user: AuthenticatedUser | null,
  {
    counts = {},
    account = { id: "cacc1", passwordHash: "hash:correct horse" },
    replaced = true,
    verifyError,
  }: {
    counts?: Record<string, number>;
    account?: { id: string; passwordHash: string } | null;
    replaced?: boolean;
    verifyError?: Error;
  } = {},
) {
  const calls: unknown[][] = [];
  const count = { ...counts };
  const deps: OwnPasswordDeps = {
    currentUser: async () => user,
    accounts: {
      credentials: async (id) => {
        calls.push(["credentials", id]);
        return account;
      },
      replacePassword: async (id, expected, hash, at) => {
        calls.push(["replacePassword", id, expected, hash, at]);
        return replaced;
      },
    },
    passwords: {
      hash: async (password) => {
        calls.push(["hash", password]);
        return `hash:${password}`;
      },
      verify: async (password, hash) => {
        calls.push(["verify", password, hash]);
        if (verifyError) throw verifyError;
        return hash === `hash:${password}`;
      },
      simulate: async (password) => {
        calls.push(["simulate", password]);
      },
    },
    throttle: {
      consume: async (key, rule, at) => {
        calls.push(["consume", key, rule, at]);
        count[key] = (count[key] ?? 0) + 1;
        return count[key] <= rule.limit;
      },
      reset: async (key) => {
        calls.push(["reset", key]);
        delete count[key];
      },
    },
    now: () => now,
  };
  return { ownPassword: createOwnPassword(deps), calls, count };
}

function named(calls: unknown[][], name: string) {
  return calls.filter((call) => call[0] === name);
}

const valid = {
  currentPassword: "correct horse",
  newPassword: "new-password",
  confirmPassword: "new-password",
};

test("who may change: password members only", async () => {
  for (const user of [
    admin,
    actingAdmin,
    ffpfMember,
    demo,
    guest,
    null,
    revoked,
    noAccountId,
  ]) {
    const { ownPassword, calls } = fakeDeps(user);
    assert.equal(await ownPassword.change(valid, client), "forbidden");
    assert.deepEqual(calls, [], JSON.stringify(user));
  }
});

test("the client's route limit comes first", async () => {
  const { ownPassword, calls, count } = fakeDeps(member, {
    counts: { [routeKey]: 10 },
  });
  assert.equal(await ownPassword.change(valid, client), "rate-limited");
  assert.deepEqual(calls, [["consume", routeKey, routeRule, now]]);
  assert.equal(count[changeKey], undefined);
});

test("the new password is checked before anything about the current one", async () => {
  const cases: [
    { currentPassword: string; newPassword: string; confirmPassword: string },
    string,
  ][] = [
    [
      { ...valid, newPassword: "elevenchars", confirmPassword: "elevenchars" },
      "invalid-new-password",
    ],
    [
      { ...valid, newPassword: "", confirmPassword: "" },
      "invalid-new-password",
    ],
    [
      {
        ...valid,
        newPassword: "x".repeat(129),
        confirmPassword: "x".repeat(129),
      },
      "invalid-new-password",
    ],
    [
      { ...valid, newPassword: "elevenchars", confirmPassword: "other" },
      "invalid-new-password",
    ],
    [
      {
        currentPassword: "wrong",
        newPassword: "elevenchars",
        confirmPassword: "elevenchars",
      },
      "invalid-new-password",
    ],
    [
      {
        ...valid,
        newPassword: "new-password",
        confirmPassword: "new-passwordx",
      },
      "password-mismatch",
    ],
    [
      {
        currentPassword: "",
        newPassword: "new-password",
        confirmPassword: "new-passwordx",
      },
      "password-mismatch",
    ],
  ];
  for (const [input, outcome] of cases) {
    const { ownPassword, calls, count } = fakeDeps(member);
    assert.equal(
      await ownPassword.change(input, client),
      outcome,
      JSON.stringify(input),
    );
    assert.deepEqual(calls, [["consume", routeKey, routeRule, now]]);
    assert.equal(count[changeKey], undefined);
  }
});

test("new passwords count UTF-16 units and keep spaces", async () => {
  for (const next of [
    "パ".repeat(12),
    "x".repeat(128),
    "パ".repeat(128),
    "  leading sp",
    "😀".repeat(6),
  ]) {
    const { ownPassword, calls } = fakeDeps(member);
    assert.equal(
      await ownPassword.change(
        { ...valid, newPassword: next, confirmPassword: next },
        client,
      ),
      "changed",
      next,
    );
    assert.deepEqual(named(calls, "replacePassword"), [
      ["replacePassword", "cacc1", "hash:correct horse", `hash:${next}`, now],
    ]);
  }
  for (const next of ["😀".repeat(65), " eleven run"]) {
    const { ownPassword, calls } = fakeDeps(member);
    assert.equal(
      await ownPassword.change(
        { ...valid, newPassword: next, confirmPassword: next },
        client,
      ),
      "invalid-new-password",
      next,
    );
    assert.deepEqual(named(calls, "replacePassword"), []);
  }
});

test("every current-password failure costs one hash and says the same", async () => {
  const failures: {
    name: string;
    current: string;
    options?: Parameters<typeof fakeDeps>[1];
    consumed: boolean;
    simulated?: string;
    verified: boolean;
  }[] = [
    {
      name: "no account",
      current: "correct horse",
      options: { account: null },
      consumed: false,
      simulated: "correct horse",
      verified: false,
    },
    {
      name: "empty",
      current: "",
      consumed: true,
      simulated: "",
      verified: false,
    },
    {
      name: "129 ASCII",
      current: "x".repeat(129),
      consumed: true,
      simulated: "x".repeat(128),
      verified: false,
    },
    {
      name: "129 katakana",
      current: "パ".repeat(129),
      consumed: true,
      simulated: "パ".repeat(128),
      verified: false,
    },
    {
      name: "locked",
      current: "correct horse",
      options: { counts: { [changeKey]: 5 } },
      consumed: true,
      simulated: "correct horse",
      verified: false,
    },
    { name: "wrong", current: "wrong", consumed: true, verified: true },
  ];
  for (const failure of failures) {
    const { ownPassword, calls } = fakeDeps(member, failure.options);
    assert.equal(
      await ownPassword.change(
        { ...valid, currentPassword: failure.current },
        client,
      ),
      "invalid-current-password",
      failure.name,
    );
    assert.deepEqual(
      named(calls, "consume").filter((call) => call[1] === changeKey),
      failure.consumed ? [["consume", changeKey, changeRule, now]] : [],
      failure.name,
    );
    assert.deepEqual(
      named(calls, "simulate"),
      failure.simulated === undefined ? [] : [["simulate", failure.simulated]],
      failure.name,
    );
    assert.equal(named(calls, "verify").length, failure.verified ? 1 : 0);
    assert.equal(
      named(calls, "verify").length + named(calls, "simulate").length,
      1,
      failure.name,
    );
    for (const name of ["hash", "replacePassword", "reset"])
      assert.deepEqual(named(calls, name), [], `${failure.name}: ${name}`);
  }
});

test("a change replaces the verified hash and bumps the session", async () => {
  const { ownPassword, calls } = fakeDeps(member);
  assert.equal(await ownPassword.change(valid, client), "changed");
  assert.deepEqual(calls, [
    ["consume", routeKey, routeRule, now],
    ["credentials", "cacc1"],
    ["consume", changeKey, changeRule, now],
    ["verify", "correct horse", "hash:correct horse"],
    ["hash", "new-password"],
    [
      "replacePassword",
      "cacc1",
      "hash:correct horse",
      "hash:new-password",
      now,
    ],
    ["reset", changeKey],
  ]);
});

test("a hash replaced meanwhile is a wrong current password", async () => {
  const { ownPassword, calls } = fakeDeps(member, { replaced: false });
  assert.equal(
    await ownPassword.change(valid, client),
    "invalid-current-password",
  );
  assert.deepEqual(named(calls, "reset"), []);
});

// The real hasher rethrows a scrypt failure (Go returns it as an error): the
// change fails as an error, never as a wrong current password, and nothing
// is replaced or reset.
test("a hasher failure is thrown, not invalid-current-password", async () => {
  const { ownPassword, calls } = fakeDeps(member, {
    verifyError: new RangeError("scrypt"),
  });
  await assert.rejects(ownPassword.change(valid, client), {
    name: "RangeError",
  });
  for (const name of ["hash", "replacePassword", "reset", "simulate"])
    assert.deepEqual(named(calls, name), [], name);
});
