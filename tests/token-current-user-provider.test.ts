import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccessClaims } from "../src/infrastructure/identity/access-token";
import {
  type FfpfIdentityAccount,
  type IdentityAccount,
  type IdentityAccounts,
  TokenCurrentUserProvider,
  type TokenIdentityConfig,
} from "../src/infrastructure/identity/token-current-user-provider";

const password: IdentityAccount = {
  id: "abc",
  loginId: "taro",
  displayName: "太郎",
  passwordHash: "hash",
  sessionVersion: 3,
};
const ffpf: FfpfIdentityAccount = {
  id: "sub1",
  email: "a@example.com",
  displayName: "花子",
  sessionVersion: 2,
};

function accounts(
  passwords: IdentityAccount[] = [password],
  ffpfs: FfpfIdentityAccount[] = [ffpf],
): IdentityAccounts {
  return {
    findPasswordAccount: async (id) =>
      passwords.find((a) => a.id === id) ?? null,
    findFfpfAccount: async (id) => ffpfs.find((a) => a.id === id) ?? null,
  };
}

function provider(
  claims: AccessClaims | null,
  options: {
    token?: string | undefined;
    actAs?: string;
    accounts?: IdentityAccounts;
    config?: Partial<TokenIdentityConfig>;
  } = {},
) {
  const token = "token" in options ? options.token : "access";
  return new TokenCurrentUserProvider(
    async () => token,
    async () => options.actAs,
    () => claims,
    options.accounts ?? accounts(),
    { allowedGitHubIds: new Set(["10001"]), ...options.config },
  );
}

const admin: AccessClaims = {
  role: "admin",
  ownerId: "10001",
  login: "octocat",
};
const member = (ownerId: string, sessionVersion: number): AccessClaims => ({
  role: "member",
  ownerId,
  sessionVersion,
});

test("no cookie or an invalid token is signed out", async () => {
  assert.equal(
    await provider(admin, { token: undefined }).getCurrentUser(),
    null,
  );
  assert.equal(await provider(null).getCurrentUser(), null);
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

test("an FFPF ID member is shown by email", async () => {
  assert.deepEqual(await provider(member("ffpf:sub1", 2)).getCurrentUser(), {
    githubLogin: "a@example.com",
    githubId: "ffpf:sub1",
    role: "member",
    displayName: "花子",
  });
});

test("a member whose sessionVersion moved on is signed out", async () => {
  assert.equal(
    await provider(member("password:abc", 2)).getCurrentUser(),
    null,
  );
  assert.equal(await provider(member("ffpf:sub1", 9)).getCurrentUser(), null);
});

test("a member whose account is gone is signed out", async () => {
  assert.equal(
    await provider(member("password:zzz", 3)).getCurrentUser(),
    null,
  );
  assert.equal(await provider(member("ffpf:zzz", 2)).getCurrentUser(), null);
});

test("a member owner id with neither prefix is signed out", async () => {
  assert.equal(await provider(member("12345", 1)).getCurrentUser(), null);
  assert.equal(await provider(member("password:", 3)).getCurrentUser(), null);
  assert.equal(await provider(member("ffpf:", 2)).getCurrentUser(), null);
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
  });
});

test("act-as a malformed or missing member is ignored", async () => {
  for (const actAs of [
    "password:ABC",
    "ffpf:x",
    "password:nope",
    "password:",
  ]) {
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
  const m = await provider(member("password:abc", 3), {
    actAs: "password:abc",
  }).getCurrentUser();
  assert.equal(m?.actAsIgnored, undefined);
  assert.equal(m?.actingAs, undefined);
  const g = await provider(
    { role: "guest", ownerId: "guest" },
    { actAs: "password:abc" },
  ).getCurrentUser();
  assert.deepEqual(g, { githubLogin: "guest", role: "guest" });
});

test("an admin off the allowlist is revoked even while acting", async () => {
  const user = await provider(
    { ...admin, ownerId: "99999" },
    { actAs: "password:abc" },
  ).getCurrentUser();
  assert.deepEqual(user, { githubLogin: "", role: "revoked" });
});
