import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BetterAuthCurrentUserProvider,
  toAuthenticatedUser,
  type BetterAuthSession,
} from "../src/infrastructure/identity/better-auth-current-user-provider";

function session(
  user: Partial<BetterAuthSession["user"]> = {},
  extra: BetterAuthSession["session"] = {},
): BetterAuthSession {
  return {
    user: { id: "u1", name: "太郎", role: "user", ...user },
    session: extra,
  };
}

test("no session is nobody", () => {
  assert.equal(toAuthenticatedUser(null, "demo"), null);
  assert.equal(toAuthenticatedUser(null, undefined), null);
});

test("a member is their user id, name and login id", () => {
  assert.deepEqual(toAuthenticatedUser(session({ username: "taro" }), "demo"), {
    userId: "u1",
    role: "member",
    displayName: "太郎",
    username: "taro",
  });
  // A Sparklingstadt ID member has no login id.
  assert.deepEqual(
    toAuthenticatedUser(session({ username: null, role: null }), undefined),
    { userId: "u1", role: "member", displayName: "太郎" },
  );
});

test("an anonymous user is a guest, whatever their role", () => {
  const user = toAuthenticatedUser(
    session({ isAnonymous: true, name: "Anonymous", role: "admin" }),
    "demo",
  );
  assert.equal(user?.role, "guest");
  assert.equal(user?.userId, "u1");
  assert.equal(user?.demo, undefined);
});

test("role admin is an admin", () => {
  assert.deepEqual(
    toAuthenticatedUser(session({ role: "admin", isAnonymous: false }), "demo"),
    { userId: "u1", role: "admin", displayName: "太郎" },
  );
});

test("a role list with admin in it is an admin, as for the admin plugin", () => {
  assert.equal(
    toAuthenticatedUser(session({ role: "admin,user" }), "demo")?.role,
    "admin",
  );
  assert.equal(
    toAuthenticatedUser(session({ role: "user, admin" }), "demo")?.role,
    "admin",
  );
  assert.equal(
    toAuthenticatedUser(session({ role: "administrator" }), "demo")?.role,
    "member",
  );
});

test("the demo login id marks the demo account", () => {
  assert.equal(
    toAuthenticatedUser(session({ username: "demo" }), "demo")?.demo,
    true,
  );
  assert.equal(
    toAuthenticatedUser(session({ username: "taro" }), "demo")?.demo,
    undefined,
  );
  // Without DEMO_LOGIN_ID there is no demo account.
  assert.equal(
    toAuthenticatedUser(session({ username: "demo" }), undefined)?.demo,
    undefined,
  );
  assert.equal(
    toAuthenticatedUser(session({ username: "demo" }), "")?.demo,
    undefined,
  );
});

test("a banned user is nobody", () => {
  assert.equal(toAuthenticatedUser(session({ banned: true }), "demo"), null);
  assert.equal(
    toAuthenticatedUser(session({ banned: true, role: "admin" }), "demo"),
    null,
  );
  assert.equal(
    toAuthenticatedUser(session({ banned: false }), "demo")?.role,
    "member",
  );
});

test("while impersonating, the user is the member and names the admin", () => {
  assert.deepEqual(
    toAuthenticatedUser(
      session({ username: "taro" }, { impersonatedBy: "adm" }),
      "demo",
    ),
    {
      userId: "u1",
      role: "member",
      displayName: "太郎",
      username: "taro",
      impersonatedBy: "adm",
    },
  );
  assert.equal(
    toAuthenticatedUser(session({}, { impersonatedBy: null }), "demo")
      ?.impersonatedBy,
    undefined,
  );
});

test("the provider reads the session once per call and maps it", async () => {
  let reads = 0;
  const provider = new BetterAuthCurrentUserProvider(async () => {
    reads += 1;
    return session({ role: "admin" });
  }, "demo");
  assert.deepEqual(await provider.getCurrentUser(), {
    userId: "u1",
    role: "admin",
    displayName: "太郎",
  });
  assert.equal(reads, 1);
  const signedOut = new BetterAuthCurrentUserProvider(async () => null, "demo");
  assert.equal(await signedOut.getCurrentUser(), null);
});
