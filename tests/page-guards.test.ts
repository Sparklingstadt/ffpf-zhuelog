import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { resolveRecordOwner } from "../src/application/identity/use-cases/resolve-record-owner";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import {
  installNextStubs,
  next,
  NotFoundSignal,
  redirectOf,
  stubSource,
} from "./helpers/next-stubs";

// What a page does with a visitor it is not for (presentation/guards):
// sign-in for the signed-out, a 404 or the home page for a guest.

installNextStubs();

const admin: AuthenticatedUser = {
  githubLogin: "admin",
  githubId: "10001",
  role: "admin",
};
const member: AuthenticatedUser = {
  githubLogin: "taro",
  githubId: "password:c1abcdefghijklmnopqrstu",
  role: "member",
};
const guest: AuthenticatedUser = { githubLogin: "guest", role: "guest" };
const revoked: AuthenticatedUser = { githubLogin: "old", role: "revoked" };

let user: AuthenticatedUser | null = null;
let listConversations: () => unknown = () => ({ conversations: [] });

stubSource("composition/identity-container", {
  // As the real getter: a revoked session is nobody.
  getCurrentViewerUser: async () => (user?.role === "revoked" ? null : user),
  getRecordOwner: async (requested: string | undefined) => ({
    user,
    owner: resolveRecordOwner(user, requested),
  }),
});
stubSource("composition/chat-container", {
  conversationNotes: { list: async () => listConversations() },
});

const chat = () => import("../src/presentation/guards/chat-guard");
const practice = () => import("../src/presentation/guards/practice-guard");
const owner = () => import("../src/presentation/guards/record-owner-guard");

const SIGN_IN = "/signin?callbackUrl=%2Fchat";

beforeEach(() => {
  next.reset();
  user = null;
  listConversations = () => ({ conversations: [] });
});

test("the chat and the practice records are for members and admins: sign-in or a 404 for the rest", async () => {
  const { requireChatUser } = await chat();
  const { requirePracticeRecordUser } = await practice();

  for (const guard of [requireChatUser, requirePracticeRecordUser]) {
    for (const nobody of [null, revoked]) {
      user = nobody;
      assert.equal((await redirectOf(() => guard(SIGN_IN))).to, SIGN_IN);
    }
    // A guest is signed in, so sign-in would not help: the page is not there.
    user = guest;
    await assert.rejects(guard(SIGN_IN), NotFoundSignal);
    for (const allowed of [member, admin]) {
      user = allowed;
      assert.equal(await guard(SIGN_IN), allowed);
    }
  }
});

test("the conversation list is the signed-in user's, and a failure to read it is thrown", async () => {
  const { loadConversationList } = await chat();
  const conversations = [{ id: "c1", title: "我今天很忙" }];

  listConversations = () => ({ conversations, chatModel: "gpt-e2e" });
  assert.deepEqual(await loadConversationList(), conversations);

  listConversations = () => {
    throw new Error("boom");
  };
  await assert.rejects(loadConversationList(), /boom/);
});

test("pages of records send the signed-out and the revoked to sign-in", async () => {
  const { requireSignedInOwner } = await owner();

  for (const visitor of [null, revoked]) {
    user = visitor;
    assert.equal(
      (await redirectOf(() => requireSignedInOwner(undefined, SIGN_IN))).to,
      SIGN_IN,
    );
  }

  // A guest is let through: pages that show a guest something decide.
  user = guest;
  assert.deepEqual(await requireSignedInOwner(undefined, SIGN_IN), {
    user: guest,
    owner: { kind: "denied", reason: "guest" },
  });
  user = member;
  assert.deepEqual(await requireSignedInOwner(undefined, SIGN_IN), {
    user: member,
    owner: { kind: "self", ownerId: member.githubId },
  });
  // A member asking for someone else is sent back to their own.
  assert.deepEqual(
    (await requireSignedInOwner(admin.githubId, SIGN_IN)).owner,
    { kind: "redirect-self" },
  );
  user = admin;
  assert.deepEqual(await requireSignedInOwner(member.githubId, SIGN_IN), {
    user: admin,
    owner: { kind: "other", ownerId: member.githubId },
  });
});

test("pages with nothing for a guest send them home", async () => {
  const { requireNonGuestOwner } = await owner();

  for (const visitor of [null, revoked]) {
    user = visitor;
    assert.equal(
      (await redirectOf(() => requireNonGuestOwner(undefined, SIGN_IN))).to,
      SIGN_IN,
    );
  }
  user = guest;
  assert.equal(
    (await redirectOf(() => requireNonGuestOwner(undefined, SIGN_IN))).to,
    "/",
  );
  user = member;
  assert.deepEqual((await requireNonGuestOwner(undefined, SIGN_IN)).owner, {
    kind: "self",
    ownerId: member.githubId,
  });
});
