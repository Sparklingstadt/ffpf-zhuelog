import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionPrincipal } from "../src/domain/identity/session";
import {
  type SidIdentityAccount,
  type IdentityAccount,
  type IdentityAccounts,
  SessionCurrentUserProvider,
  type SessionIdentityConfig,
} from "../src/infrastructure/identity/session-current-user-provider";

const password: IdentityAccount = {
  id: "abc",
  loginId: "taro",
  displayName: "太郎",
  passwordHash: "hash",
  sessionVersion: 3,
};
const sid: SidIdentityAccount = {
  id: "sub1",
  email: "a@example.com",
  displayName: "花子",
  sessionVersion: 2,
};

function accounts(
  passwords: IdentityAccount[] = [password],
  sids: SidIdentityAccount[] = [sid],
): IdentityAccounts {
  return {
    findPasswordAccount: async (id) =>
      passwords.find((a) => a.id === id) ?? null,
    findSidAccount: async (id) => sids.find((a) => a.id === id) ?? null,
  };
}

function provider(
  principal: SessionPrincipal | null,
  options: {
    token?: string | undefined;
    actAs?: string;
    accounts?: IdentityAccounts;
    config?: Partial<SessionIdentityConfig>;
  } = {},
) {
  const token = "token" in options ? options.token : "session-token";
  const lookups: string[] = [];
  const instance = new SessionCurrentUserProvider(
    async () => token,
    async () => options.actAs,
    async (t) => {
      lookups.push(t);
      return principal;
    },
    options.accounts ?? accounts(),
    { allowedGitHubIds: new Set(["10001"]), ...options.config },
  );
  return Object.assign(instance, { lookups });
}

const admin: SessionPrincipal = {
  role: "admin",
  ownerId: "10001",
  login: "octocat",
};
const member = (ownerId: string, sessionVersion: number): SessionPrincipal => ({
  role: "member",
  ownerId,
  sessionVersion,
});

test("no cookie or an unknown token is signed out", async () => {
  assert.equal(
    await provider(admin, { token: undefined }).getCurrentUser(),
    null,
  );
  assert.equal(await provider(null).getCurrentUser(), null);
});

test("a cookie the store does not find is signed out", async () => {
  // The store answers null for an expired, deleted or malformed session.
  const p = provider(null, { actAs: "password:abc" });
  assert.equal(await p.getCurrentUser(), null);
  assert.deepEqual(p.lookups, ["session-token"]);
});

test("no cookie never asks the store", async () => {
  for (const token of [undefined, ""]) {
    const p = provider(admin, { token });
    assert.equal(await p.getCurrentUser(), null);
    assert.deepEqual(p.lookups, []);
  }
});

test("an admin on the allowlist keeps the GitHub login and id", async () => {
  assert.deepEqual(await provider(admin).getCurrentUser(), {
    githubLogin: "octocat",
    githubId: "10001",
    role: "admin",
  });
});

test("an admin no longer on the allowlist is revoked", async () => {
  const user = await provider({ ...admin, ownerId: "99999" }).getCurrentUser();
  assert.deepEqual(user, { githubLogin: "", role: "revoked" });
});

test("a password member gets the profile and account id", async () => {
  assert.deepEqual(await provider(member("password:abc", 3)).getCurrentUser(), {
    githubLogin: "taro",
    githubId: "password:abc",
    role: "member",
    displayName: "太郎",
    accountId: "abc",
  });
});

test("a Sparklingstadt ID member is shown by email", async () => {
  assert.deepEqual(await provider(member("sid:sub1", 2)).getCurrentUser(), {
    githubLogin: "a@example.com",
    githubId: "sid:sub1",
    role: "member",
    displayName: "花子",
  });
});

test("a member whose sessionVersion moved on is signed out", async () => {
  assert.equal(
    await provider(member("password:abc", 2)).getCurrentUser(),
    null,
  );
  assert.equal(await provider(member("sid:sub1", 9)).getCurrentUser(), null);
});

test("a member whose account is gone is signed out", async () => {
  assert.equal(
    await provider(member("password:zzz", 3)).getCurrentUser(),
    null,
  );
  assert.equal(await provider(member("sid:zzz", 2)).getCurrentUser(), null);
});

test("a member owner id with neither prefix is signed out", async () => {
  assert.equal(await provider(member("12345", 1)).getCurrentUser(), null);
  assert.equal(await provider(member("password:", 3)).getCurrentUser(), null);
  assert.equal(await provider(member("sid:", 2)).getCurrentUser(), null);
});

test("the demo account is flagged", async () => {
  const noPassword = accounts([
    { ...password, passwordHash: "demo:no-password" },
  ]);
  assert.equal(
    (
      await provider(member("password:abc", 3), {
        accounts: noPassword,
      }).getCurrentUser()
    )?.demo,
    true,
  );
  const byLogin = await provider(member("password:abc", 3), {
    config: { demoLoginId: "taro" },
  }).getCurrentUser();
  assert.equal(byLogin?.demo, true);
  const plain = await provider(member("password:abc", 3), {
    config: { demoLoginId: "other" },
  }).getCurrentUser();
  assert.equal(plain && "demo" in plain, false);
});

test("a guest owns no records", async () => {
  const user = await provider({
    role: "guest",
    ownerId: "guest",
  }).getCurrentUser();
  assert.deepEqual(user, { githubLogin: "guest", role: "guest" });
});

test("an admin acts as an existing member", async () => {
  const user = await provider(admin, {
    actAs: "password:abc",
  }).getCurrentUser();
  assert.deepEqual(user, {
    githubLogin: "octocat",
    githubId: "password:abc",
    role: "admin",
    actingAs: { ownerId: "password:abc", loginId: "taro", displayName: "太郎" },
    actorId: "10001",
  });
});

test("act-as a malformed or missing member is ignored", async () => {
  for (const actAs of ["password:ABC", "sid:x", "password:nope", "password:"]) {
    const user = await provider(admin, { actAs }).getCurrentUser();
    assert.deepEqual(
      user,
      {
        githubLogin: "octocat",
        githubId: "10001",
        role: "admin",
        actAsIgnored: true,
      },
      actAs,
    );
  }
});

test("act-as is ignored for members and guests", async () => {
  const other: IdentityAccount = { ...password, id: "def", loginId: "jiro" };
  const m = await provider(member("password:abc", 3), {
    actAs: "password:def",
    accounts: accounts([password, other]),
  }).getCurrentUser();
  assert.deepEqual(m, {
    githubLogin: "taro",
    githubId: "password:abc",
    role: "member",
    displayName: "太郎",
    accountId: "abc",
  });
  const g = await provider(
    { role: "guest", ownerId: "guest" },
    { actAs: "password:abc" },
  ).getCurrentUser();
  assert.deepEqual(g, { githubLogin: "guest", role: "guest" });
});

test("lookup errors propagate instead of signing out", async () => {
  const boom = new Error("db down");
  const failing: IdentityAccounts = {
    findPasswordAccount: async () => {
      throw boom;
    },
    findSidAccount: async () => {
      throw boom;
    },
  };
  await assert.rejects(
    provider(member("password:abc", 3), { accounts: failing }).getCurrentUser(),
    boom,
  );
  await assert.rejects(
    provider(member("sid:sub1", 2), { accounts: failing }).getCurrentUser(),
    boom,
  );
  await assert.rejects(
    provider(admin, {
      actAs: "password:abc",
      accounts: failing,
    }).getCurrentUser(),
    boom,
  );
});

test("an admin off the allowlist is revoked even while acting", async () => {
  const user = await provider(
    { ...admin, ownerId: "99999" },
    { actAs: "password:abc" },
  ).getCurrentUser();
  assert.deepEqual(user, { githubLogin: "", role: "revoked" });
});
