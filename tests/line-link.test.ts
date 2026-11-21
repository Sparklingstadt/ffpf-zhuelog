import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createLineLink,
  LineLinkForbiddenError,
  type LineLinkDeps,
} from "../src/application/line/line-link";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";

const t0 = new Date("2026-11-17T03:00:00.000Z");

const member: AuthenticatedUser = {
  githubLogin: "taro",
  githubId: "password:c1",
  role: "member",
  accountId: "c1",
};
const admin: AuthenticatedUser = {
  githubLogin: "octocat",
  githubId: "10001",
  role: "admin",
};
const actingAdmin: AuthenticatedUser = {
  githubLogin: "octocat",
  githubId: "password:c1",
  role: "admin",
  actingAs: { ownerId: "password:c1", loginId: "taro", displayName: "太郎" },
  actorId: "10001",
};
const demo: AuthenticatedUser = {
  githubLogin: "demo",
  githubId: "password:demo",
  role: "member",
  demo: true,
};
const guest: AuthenticatedUser = { githubLogin: "g", role: "guest" };
const revoked: AuthenticatedUser = { ...member, role: "revoked" };
const noGithubId: AuthenticatedUser = { githubLogin: "x", role: "member" };

function harness(
  user: AuthenticatedUser | null,
  more: Partial<LineLinkDeps> & { reviewNotify?: boolean } = {},
) {
  const calls: unknown[][] = [];
  const deps: LineLinkDeps = {
    currentUser: async () => user,
    enabled: true,
    store: {
      async status(ownerId) {
        calls.push(["status", ownerId]);
        return { linked: true, reviewNotify: true };
      },
      async setReviewNotify(ownerId, on) {
        calls.push(["setReviewNotify", ownerId, on]);
        return more.reviewNotify ?? true;
      },
      async unlinkOwner(ownerId) {
        calls.push(["unlinkOwner", ownerId]);
      },
      async putCode(ownerId, role, codeHash, expiresAt) {
        calls.push(["putCode", ownerId, role, codeHash, expiresAt]);
      },
    },
    newCode: () => "ABCD2345",
    hashCode: (code) => `hash(${code})`,
    now: () => t0,
    ...more,
  };
  return { link: createLineLink(deps), calls };
}

test("only members and admins who are themselves may link", async () => {
  for (const user of [demo, actingAdmin, guest, revoked, noGithubId, null]) {
    const { link, calls } = harness(user);
    await assert.rejects(link.status(), LineLinkForbiddenError);
    await assert.rejects(link.issueCode(), LineLinkForbiddenError);
    await assert.rejects(link.unlink(), LineLinkForbiddenError);
    await assert.rejects(link.setReviewNotify(true), LineLinkForbiddenError);
    assert.deepEqual(calls, []);
  }

  // Refused before LINE's availability is looked at.
  const { link } = harness(demo, { enabled: false });
  await assert.rejects(link.status(), LineLinkForbiddenError);

  for (const [user, owner] of [
    [member, "password:c1"],
    [admin, "10001"],
  ] as const) {
    const { link, calls } = harness(user);
    assert.deepEqual(await link.status(), {
      available: true,
      linked: true,
      reviewNotify: true,
    });
    await link.unlink();
    assert.equal(await link.setReviewNotify(false), true);
    assert.deepEqual(calls, [
      ["status", owner],
      ["unlinkOwner", owner],
      ["setReviewNotify", owner, false],
    ]);
  }
});

test("a code is issued for ten minutes and only its hash is stored", async () => {
  const expiresAt = new Date(t0.getTime() + 600_000);
  let h = harness(member);
  assert.deepEqual(await h.link.issueCode(), { code: "ABCD2345", expiresAt });
  assert.deepEqual(h.calls, [
    ["putCode", "password:c1", "member", "hash(ABCD2345)", expiresAt],
  ]);

  h = harness(admin);
  await h.link.issueCode();
  assert.deepEqual(h.calls, [
    ["putCode", "10001", "admin", "hash(ABCD2345)", expiresAt],
  ]);
});

test("without LINE the page says unavailable and nothing is read", async () => {
  const { link, calls } = harness(member, { enabled: false });
  assert.deepEqual(await link.status(), {
    available: false,
    linked: false,
    reviewNotify: false,
  });
  assert.equal(await link.setReviewNotify(true), false);
  await link.unlink();
  await assert.rejects(link.issueCode(), (error) => {
    assert.ok(!(error instanceof LineLinkForbiddenError));
    assert.equal((error as Error).message, "LINE_UNAVAILABLE");
    return true;
  });
  assert.deepEqual(calls, []);
});

test("the review message setting needs a link", async () => {
  const { link, calls } = harness(member, { reviewNotify: false });
  assert.equal(await link.setReviewNotify(true), false);
  assert.deepEqual(calls, [["setReviewNotify", "password:c1", true]]);
});
