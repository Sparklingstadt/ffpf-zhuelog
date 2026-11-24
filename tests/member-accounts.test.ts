import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AccountAdminForbiddenError,
  createMemberAccounts,
  type MemberAccountsDeps,
} from "../src/application/identity/member-accounts";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import type { MemberAccount } from "../src/domain/identity/member-account";

const admin: AuthenticatedUser = {
  githubLogin: "octocat",
  githubId: "10001",
  role: "admin",
};
const actingAdmin: AuthenticatedUser = {
  githubLogin: "octocat",
  githubId: "password:cacc1",
  role: "admin",
  actingAs: {
    ownerId: "password:cacc1",
    loginId: "alice",
    displayName: "Alice",
  },
  actorId: "10001",
};
const member: AuthenticatedUser = {
  githubLogin: "alice",
  githubId: "password:cacc1",
  role: "member",
  accountId: "cacc1",
};
const demo: AuthenticatedUser = {
  githubLogin: "demo",
  githubId: "demo:1",
  role: "member",
  demo: true,
};
const guest: AuthenticatedUser = { githubLogin: "g", role: "guest" };
const revoked: AuthenticatedUser = { ...admin, role: "revoked" };

const now = new Date("2026-11-17T03:00:00.000Z");

const account: MemberAccount = {
  id: "cacc1",
  ownerId: "password:cacc1",
  loginId: "alice.w",
  displayName: "Alice",
  createdAt: now,
};

type Store = MemberAccountsDeps["store"];

function fakeDeps(
  user: AuthenticatedUser | null,
  store: Partial<Store> = {},
  generated = "GENERATEDpassword123",
) {
  const calls: unknown[][] = [];
  const hashed: string[] = [];
  const deps: MemberAccountsDeps = {
    currentUser: async () => user,
    store: {
      list: async () => {
        calls.push(["list"]);
        return [account];
      },
      create: async (input, at) => {
        calls.push(["create", input, at]);
        return store.create
          ? store.create(input, at)
          : { ...account, loginId: input.loginId };
      },
      loginIdOf: async (id) => {
        calls.push(["loginIdOf", id]);
        return store.loginIdOf ? store.loginIdOf(id) : "alice";
      },
      setPassword: async (id, hash, at) => {
        calls.push(["setPassword", id, hash, at]);
        return store.setPassword ? store.setPassword(id, hash, at) : "alice";
      },
    },
    hashPassword: async (password) => {
      hashed.push(password);
      return `hash:${password}`;
    },
    generatePassword: () => generated,
    now: () => now,
  };
  return { accounts: createMemberAccounts(deps), calls, hashed };
}

test("only admins manage accounts", async () => {
  for (const user of [admin, actingAdmin]) {
    const { accounts } = fakeDeps(user);
    assert.deepEqual(await accounts.list(), [account]);
  }
  for (const user of [member, demo, guest, null, revoked]) {
    const { accounts, calls, hashed } = fakeDeps(user);
    await assert.rejects(accounts.list(), AccountAdminForbiddenError);
    await assert.rejects(
      accounts.create({
        loginId: "alice",
        displayName: "Alice",
        password: "",
      }),
      AccountAdminForbiddenError,
    );
    await assert.rejects(
      accounts.resetPassword("cacc1", ""),
      AccountAdminForbiddenError,
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(hashed, []);
  }
});

test("create checks loginId, then name, then password", async () => {
  // The table of checkNewAccount's failures (tests/password-account.test.ts).
  const cases = [
    [{ loginId: "ab", displayName: "x", password: "" }, "login-id"],
    [{ loginId: "!", displayName: "", password: "x" }, "login-id"],
    [{ loginId: "abc", displayName: "   ", password: "" }, "display-name"],
    [{ loginId: "abc", displayName: "", password: "x" }, "display-name"],
    [{ loginId: "abc", displayName: "x", password: "12345678901" }, "password"],
  ] as const;
  for (const [raw, reason] of cases) {
    const { accounts, calls, hashed } = fakeDeps(admin);
    assert.deepEqual(
      await accounts.create(raw),
      { ok: false, reason },
      JSON.stringify(raw),
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(hashed, []);
  }
});

test("create stores the trimmed account with the hash of the password it hands out", async () => {
  {
    const { accounts, calls } = fakeDeps(admin);
    const result = await accounts.create({
      loginId: "  Alice.W ",
      displayName: "  Alice  ",
      password: "",
    });
    assert.deepEqual(calls, [
      [
        "create",
        {
          loginId: "alice.w",
          displayName: "Alice",
          passwordHash: "hash:GENERATEDpassword123",
        },
        now,
      ],
    ]);
    assert.deepEqual(result, {
      ok: true,
      issued: {
        loginId: "alice.w",
        password: "GENERATEDpassword123",
        generated: true,
      },
    });
  }
  {
    const { accounts, hashed } = fakeDeps(admin);
    const result = await accounts.create({
      loginId: "alice",
      displayName: "Alice",
      password: "  keep spaces 1 ",
    });
    assert.deepEqual(hashed, ["  keep spaces 1 "]);
    assert.deepEqual(result, {
      ok: true,
      issued: {
        loginId: "alice",
        password: "  keep spaces 1 ",
        generated: false,
      },
    });
  }
  {
    const { accounts, hashed } = fakeDeps(admin);
    const result = await accounts.create({
      loginId: "alice",
      displayName: "Alice",
      password: "   \t ",
    });
    assert.deepEqual(hashed, ["GENERATEDpassword123"]);
    assert.deepEqual(result, {
      ok: true,
      issued: {
        loginId: "alice",
        password: "GENERATEDpassword123",
        generated: true,
      },
    });
  }
  {
    const { accounts } = fakeDeps(admin, { create: async () => null });
    assert.deepEqual(
      await accounts.create({
        loginId: "alice",
        displayName: "Alice",
        password: "",
      }),
      { ok: false, reason: "login-id-taken" },
    );
  }
});

test("reset checks the password before the account and hashes nothing for a missing one", async () => {
  {
    const { accounts, calls, hashed } = fakeDeps(admin);
    assert.deepEqual(await accounts.resetPassword("missing", "short"), {
      ok: false,
      reason: "password",
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(hashed, []);
  }
  for (const id of ["", "a\u0000b"]) {
    const { accounts, calls, hashed } = fakeDeps(admin);
    assert.deepEqual(await accounts.resetPassword(id, ""), {
      ok: false,
      reason: "not-found",
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(hashed, []);
  }
  {
    // The bound id reaches the server action as the client sent it.
    const { accounts, calls, hashed } = fakeDeps(admin);
    const forged = 42 as unknown as string;
    assert.deepEqual(await accounts.resetPassword(forged, ""), {
      ok: false,
      reason: "not-found",
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(hashed, []);
  }
  {
    const { accounts, calls, hashed } = fakeDeps(admin, {
      loginIdOf: async () => null,
    });
    assert.deepEqual(await accounts.resetPassword("cx", ""), {
      ok: false,
      reason: "not-found",
    });
    assert.deepEqual(calls, [["loginIdOf", "cx"]]);
    assert.deepEqual(hashed, []);
  }
  {
    const { accounts, calls } = fakeDeps(admin);
    assert.deepEqual(await accounts.resetPassword("cx", "a brand new pw"), {
      ok: true,
      issued: {
        loginId: "alice",
        password: "a brand new pw",
        generated: false,
      },
    });
    assert.deepEqual(calls, [
      ["loginIdOf", "cx"],
      ["setPassword", "cx", "hash:a brand new pw", now],
    ]);
  }
  {
    const { accounts } = fakeDeps(admin, { setPassword: async () => null });
    assert.deepEqual(await accounts.resetPassword("cx", "a brand new pw"), {
      ok: false,
      reason: "not-found",
    });
  }
});
