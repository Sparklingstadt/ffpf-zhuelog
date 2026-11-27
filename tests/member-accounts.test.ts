import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AccountAdminForbiddenError,
  createMemberAccounts,
  type AdminApiUser,
  type MemberAccountsDeps,
} from "../src/application/identity/member-accounts";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import { memberEmail } from "../src/domain/identity/password-account";

const admin: AuthenticatedUser = {
  userId: "admin1",
  role: "admin",
  displayName: "管理者",
};
const impersonated: AuthenticatedUser = {
  userId: "u1",
  role: "member",
  displayName: "Alice",
  username: "alice",
  impersonatedBy: "admin1",
};
const member: AuthenticatedUser = {
  userId: "u1",
  role: "member",
  displayName: "alice",
  username: "alice",
};
const demo: AuthenticatedUser = {
  userId: "demo1",
  role: "member",
  displayName: "demo",
  demo: true,
};
const guest: AuthenticatedUser = {
  userId: "g1",
  role: "guest",
  displayName: "g",
};

const at = (day: number) =>
  new Date(`2026-11-${String(day).padStart(2, "0")}T03:00:00.000Z`);

// What Better Auth's listUsers answers: every user who is not a guest.
const users: AdminApiUser[] = [
  {
    id: "u1",
    name: "Alice",
    username: "alice.w",
    role: "user",
    isAnonymous: false,
    createdAt: at(1),
  },
  { id: "admin1", name: "管理者", role: "admin", createdAt: at(2) },
  // A Sparklingstadt ID member: no login id, no password here.
  { id: "s1", name: "雪菜", username: null, role: "user", createdAt: at(3) },
];

// A fake auth.api: records each call and answers from `answers`.
function fakeDeps(
  user: AuthenticatedUser | null,
  answers: Partial<Record<keyof MemberAccountsDeps["api"], () => unknown>> = {},
  generated = "GENERATEDpassword123",
) {
  const calls: unknown[][] = [];
  const headers = new Headers({ cookie: "better-auth.session_token=admin" });
  const call =
    (name: keyof MemberAccountsDeps["api"], fallback: () => unknown) =>
    async (input: unknown) => {
      calls.push([name, input]);
      return (answers[name] ?? fallback)();
    };
  const deps: MemberAccountsDeps = {
    currentUser: async () => user,
    headers: async () => headers,
    api: {
      listUsers: call("listUsers", () => ({ users })) as never,
      getUser: call("getUser", () => users[0]) as never,
      createUser: call("createUser", () => ({ user: users[0] })) as never,
      setUserPassword: call("setUserPassword", () => ({
        status: true,
      })) as never,
      revokeUserSessions: call("revokeUserSessions", () => ({
        success: true,
      })) as never,
    },
    generatePassword: () => generated,
  };
  return { accounts: createMemberAccounts(deps), calls, headers };
}

const apiError = (code: string, status = "BAD_REQUEST") =>
  Object.assign(new Error(code), { status, body: { code } });

test("only admins manage accounts, and not while impersonating", async () => {
  for (const user of [member, impersonated, demo, guest, null]) {
    const { accounts, calls } = fakeDeps(user);
    await assert.rejects(accounts.list(), AccountAdminForbiddenError);
    await assert.rejects(
      accounts.create({ loginId: "alice", displayName: "Alice", password: "" }),
      AccountAdminForbiddenError,
    );
    await assert.rejects(
      accounts.resetPassword("u1", ""),
      AccountAdminForbiddenError,
    );
    assert.deepEqual(calls, []);
  }
});

test("the list is every member (not admins or guests), oldest first, from Better Auth's users", async () => {
  const { accounts, calls, headers } = fakeDeps(admin);
  assert.deepEqual(await accounts.list(), [
    { id: "u1", loginId: "alice.w", displayName: "Alice", createdAt: at(1) },
    { id: "s1", loginId: null, displayName: "雪菜", createdAt: at(3) },
  ]);
  assert.deepEqual(calls, [
    [
      "listUsers",
      {
        query: {
          filterField: "isAnonymous",
          filterValue: false,
          sortBy: "createdAt",
          sortDirection: "asc",
        },
        headers,
      },
    ],
  ]);
});

test("create checks loginId, then name, then password, before calling Better Auth", async () => {
  // The table of checkNewAccount's failures (tests/password-account.test.ts).
  const cases = [
    [{ loginId: "ab", displayName: "x", password: "" }, "login-id"],
    [{ loginId: "!", displayName: "", password: "x" }, "login-id"],
    [{ loginId: "abc", displayName: "   ", password: "" }, "display-name"],
    [{ loginId: "abc", displayName: "", password: "x" }, "display-name"],
    [{ loginId: "abc", displayName: "x", password: "12345678901" }, "password"],
  ] as const;
  for (const [raw, reason] of cases) {
    const { accounts, calls } = fakeDeps(admin);
    assert.deepEqual(
      await accounts.create(raw),
      { ok: false, reason },
      JSON.stringify(raw),
    );
    assert.deepEqual(calls, []);
  }
});

test("create sends the normalized login id as username and its member mail address", async () => {
  {
    const { accounts, calls, headers } = fakeDeps(admin);
    const result = await accounts.create({
      loginId: "  Alice.W ",
      displayName: "  Alice  ",
      password: "",
    });
    assert.deepEqual(calls, [
      [
        "createUser",
        {
          body: {
            email: memberEmail("alice.w"),
            password: "GENERATEDpassword123",
            name: "Alice",
            data: { username: "alice.w" },
          },
          headers,
        },
      ],
    ]);
    assert.equal(memberEmail("alice.w"), "alice.w@members.zhuelog.invalid");
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
    // A typed password is kept as typed (spaces too).
    const { accounts, calls } = fakeDeps(admin);
    const result = await accounts.create({
      loginId: "alice",
      displayName: "Alice",
      password: "  keep spaces 1 ",
    });
    assert.equal(
      (calls[0][1] as { body: { password: string } }).body.password,
      "  keep spaces 1 ",
    );
    assert.deepEqual(result, {
      ok: true,
      issued: {
        loginId: "alice",
        password: "  keep spaces 1 ",
        generated: false,
      },
    });
  }
});

test("a taken login id (or its mail address) is told; other failures are thrown", async () => {
  for (const code of [
    "USERNAME_IS_ALREADY_TAKEN",
    "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
  ]) {
    const { accounts } = fakeDeps(admin, {
      createUser: () => {
        throw apiError(code);
      },
    });
    assert.deepEqual(
      await accounts.create({
        loginId: "alice",
        displayName: "Alice",
        password: "",
      }),
      { ok: false, reason: "login-id-taken" },
    );
  }
  const { accounts } = fakeDeps(admin, {
    createUser: () => {
      throw new TypeError("db down");
    },
  });
  await assert.rejects(
    accounts.create({ loginId: "alice", displayName: "Alice", password: "" }),
    TypeError,
  );
});

test("reset checks the password before the account and touches nothing for a bad one", async () => {
  {
    const { accounts, calls } = fakeDeps(admin);
    assert.deepEqual(await accounts.resetPassword("u1", "short"), {
      ok: false,
      reason: "password",
    });
    assert.deepEqual(calls, []);
  }
  // The bound id reaches the server action as the client sent it.
  for (const id of ["", "a\u0000b", 42 as unknown as string]) {
    const { accounts, calls } = fakeDeps(admin);
    assert.deepEqual(await accounts.resetPassword(id, ""), {
      ok: false,
      reason: "not-found",
    });
    assert.deepEqual(calls, []);
  }
});

test("reset is only for a member with a login id; anyone else is not found", async () => {
  const targets: (() => unknown)[] = [
    () => {
      throw apiError("USER_NOT_FOUND", "NOT_FOUND");
    },
    () => users[1], // an admin
    () => users[2], // a Sparklingstadt ID member
    () => ({ ...users[0], isAnonymous: true }), // a guest
  ];
  for (const getUser of targets) {
    const { accounts, calls, headers } = fakeDeps(admin, { getUser });
    assert.deepEqual(await accounts.resetPassword("x1", ""), {
      ok: false,
      reason: "not-found",
    });
    assert.deepEqual(calls, [["getUser", { query: { id: "x1" }, headers }]]);
  }
  // Anything else than "not found" is not swallowed.
  const { accounts } = fakeDeps(admin, {
    getUser: () => {
      throw new TypeError("db down");
    },
  });
  await assert.rejects(accounts.resetPassword("x1", ""), TypeError);
});

test("reset sets the password, then ends every session of the member", async () => {
  const { accounts, calls, headers } = fakeDeps(admin);
  assert.deepEqual(await accounts.resetPassword("u1", "a brand new pw"), {
    ok: true,
    issued: {
      loginId: "alice.w",
      password: "a brand new pw",
      generated: false,
    },
  });
  assert.deepEqual(calls, [
    ["getUser", { query: { id: "u1" }, headers }],
    [
      "setUserPassword",
      { body: { userId: "u1", newPassword: "a brand new pw" }, headers },
    ],
    ["revokeUserSessions", { body: { userId: "u1" }, headers }],
  ]);

  const blank = fakeDeps(admin);
  assert.deepEqual(await blank.accounts.resetPassword("u1", "  "), {
    ok: true,
    issued: {
      loginId: "alice.w",
      password: "GENERATEDpassword123",
      generated: true,
    },
  });
});
