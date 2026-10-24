import assert from "node:assert/strict";
import { test } from "node:test";
import { GoApiError, type GoMe } from "../src/infrastructure/go-api/client";
import { GoApiCurrentUserProvider } from "../src/infrastructure/go-api/go-api-current-user-provider";

function provider(
  me: (token: string) => Promise<GoMe>,
  ...token: [string | undefined] | []
) {
  const value = token.length ? token[0] : "access";
  return new GoApiCurrentUserProvider(async () => value, me);
}

test("an admin keeps the GitHub login and id", async () => {
  const user = await provider(async () => ({
    ownerId: "12345",
    role: "admin",
    login: "octocat",
  })).getCurrentUser();
  assert.deepEqual(user, {
    githubLogin: "octocat",
    githubId: "12345",
    role: "admin",
  });
});

test("a member also carries the display name and account id", async () => {
  const user = await provider(async () => ({
    ownerId: "pw_abc",
    role: "member",
    login: "taro",
    displayName: "太郎",
    accountId: "abc",
  })).getCurrentUser();
  assert.deepEqual(user, {
    githubLogin: "taro",
    githubId: "pw_abc",
    role: "member",
    displayName: "太郎",
    accountId: "abc",
  });
});

test("a guest has no member fields even if the API sends them", async () => {
  const user = await provider(async () => ({
    ownerId: "guest",
    role: "guest",
    login: "guest",
    displayName: "x",
    accountId: "y",
  })).getCurrentUser();
  // Guests carry no githubId.
  assert.deepEqual(user, {
    githubLogin: "guest",
    role: "guest",
  });
});

test("the access token is passed to /v1/me", async () => {
  let seen: string | undefined;
  await provider(async (token) => {
    seen = token;
    return { ownerId: "1", role: "admin", login: "a" };
  }, "tok").getCurrentUser();
  assert.equal(seen, "tok");
});

test("no access token means signed out, without calling the API", async () => {
  let called = false;
  const user = await provider(async () => {
    called = true;
    throw new Error("unexpected");
  }, undefined).getCurrentUser();
  assert.equal(user, null);
  assert.equal(called, false);
});

test("401 means signed out", async () => {
  const user = await provider(async () => {
    throw new GoApiError(401, "unauthorized");
  }).getCurrentUser();
  assert.equal(user, null);
});

test("403 means a revoked session", async () => {
  const user = await provider(async () => {
    throw new GoApiError(403, "forbidden");
  }).getCurrentUser();
  assert.deepEqual(user, { githubLogin: "", role: "revoked" });
});

test("other failures are thrown", async () => {
  await assert.rejects(
    provider(async () => {
      throw new GoApiError(500, "internal");
    }).getCurrentUser(),
    (error) => error instanceof GoApiError && error.status === 500,
  );
  await assert.rejects(
    provider(async () => {
      throw new GoApiError(0, "unavailable");
    }).getCurrentUser(),
    (error) => error instanceof GoApiError && error.status === 0,
  );
});

function actingProvider(
  me: (token: string, actAs?: string) => Promise<GoMe>,
  actAs: string | undefined = "password:abc",
) {
  return new GoApiCurrentUserProvider(
    async () => "access",
    me,
    async () => actAs,
  );
}

const admin: GoMe = { ownerId: "12345", role: "admin", login: "octocat" };

test("an admin acting as a member owns the member's records", async () => {
  const asked: (string | undefined)[] = [];
  const user = await actingProvider(async (_token, actAs) => {
    asked.push(actAs);
    return {
      ownerId: "password:abc",
      role: "admin",
      login: "octocat",
      actingAs: {
        ownerId: "password:abc",
        loginId: "test01",
        displayName: "テスト",
      },
    };
  }).getCurrentUser();
  assert.deepEqual(asked, ["password:abc"]);
  assert.deepEqual(user, {
    githubLogin: "octocat",
    githubId: "password:abc",
    role: "admin",
    actingAs: {
      ownerId: "password:abc",
      loginId: "test01",
      displayName: "テスト",
    },
  });
});

test("an API that ignores the header leaves the admin as themself, flagged", async () => {
  const user = await actingProvider(async () => admin).getCurrentUser();
  assert.deepEqual(user, {
    githubLogin: "octocat",
    githubId: "12345",
    role: "admin",
    actAsIgnored: true,
  });
});

test("a refused member falls back to the admin, flagged", async () => {
  for (const status of [400, 403, 404]) {
    const asked: (string | undefined)[] = [];
    const user = await actingProvider(async (_token, actAs) => {
      asked.push(actAs);
      if (actAs) throw new GoApiError(status, "x");
      return admin;
    }).getCurrentUser();
    assert.deepEqual(asked, ["password:abc", undefined], String(status));
    assert.equal(user?.githubId, "12345");
    assert.equal(user?.actAsIgnored, true);
    assert.equal(user?.actingAs, undefined);
  }
});

test("acting keeps the usual 401 and failure handling", async () => {
  assert.equal(
    await actingProvider(async () => {
      throw new GoApiError(401, "unauthorized");
    }).getCurrentUser(),
    null,
  );
  await assert.rejects(
    actingProvider(async () => {
      throw new GoApiError(500, "internal");
    }).getCurrentUser(),
    (error) => error instanceof GoApiError && error.status === 500,
  );
});

test("a member with a stray act-as cookie is just the member", async () => {
  const user = await actingProvider(async (_token, actAs) => {
    if (actAs) throw new GoApiError(403, "forbidden");
    return { ownerId: "password:me", role: "member", login: "m" };
  }).getCurrentUser();
  assert.deepEqual(user, {
    githubLogin: "m",
    githubId: "password:me",
    role: "member",
    displayName: undefined,
    accountId: undefined,
  });
});
