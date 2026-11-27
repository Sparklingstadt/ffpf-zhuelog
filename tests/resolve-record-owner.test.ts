import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AppRole,
  AuthenticatedUser,
} from "../src/domain/identity/entities/authenticated-user";
import { isUserId } from "../src/domain/identity/user-id";
import {
  resolveRecordOwner,
  showsRecords,
} from "../src/application/identity/use-cases/resolve-record-owner";

// Better Auth user ids (32 letters and digits by default).
const ADMIN_ID = "Adm1nUserIdAAAAAAAAAAAAAAAAAAAAA";
const MEMBER_ID = "MemberUserIdBBBBBBBBBBBBBBBBBBBB";

const user = (role: AppRole, userId: string): AuthenticatedUser => ({
  userId,
  role,
  displayName: "太郎",
});

test("unauthenticated users and guests are denied", () => {
  assert.deepEqual(resolveRecordOwner(null, undefined), {
    kind: "denied",
    reason: "unauthenticated",
  });
  assert.deepEqual(resolveRecordOwner(user("guest", "g1"), undefined), {
    kind: "denied",
    reason: "guest",
  });
  assert.deepEqual(resolveRecordOwner(user("guest", "g1"), MEMBER_ID), {
    kind: "denied",
    reason: "guest",
  });
});

test("admin sees self by default and may view another user by id", () => {
  const admin = user("admin", ADMIN_ID);
  const self = { kind: "self", ownerId: ADMIN_ID };
  assert.deepEqual(resolveRecordOwner(admin, undefined), self);
  assert.deepEqual(resolveRecordOwner(admin, ""), self);
  assert.deepEqual(resolveRecordOwner(admin, ADMIN_ID), self);
  assert.deepEqual(resolveRecordOwner(admin, MEMBER_ID), {
    kind: "other",
    ownerId: MEMBER_ID,
  });
  assert.deepEqual(resolveRecordOwner(admin, "a_b-C9"), {
    kind: "other",
    ownerId: "a_b-C9",
  });
});

test("admin with a malformed user id is sent back to self", () => {
  const admin = user("admin", ADMIN_ID);
  for (const bad of [
    "../x",
    "password:x",
    "sid:cabc",
    "a b",
    "a".repeat(65),
    "x\n",
  ])
    assert.deepEqual(
      resolveRecordOwner(admin, bad),
      { kind: "redirect-self" },
      JSON.stringify(bad),
    );
});

test("member sees self and never anyone else", () => {
  const member = user("member", MEMBER_ID);
  assert.deepEqual(resolveRecordOwner(member, undefined), {
    kind: "self",
    ownerId: MEMBER_ID,
  });
  assert.deepEqual(resolveRecordOwner(member, MEMBER_ID), {
    kind: "self",
    ownerId: MEMBER_ID,
  });
  assert.deepEqual(resolveRecordOwner(member, ADMIN_ID), {
    kind: "redirect-self",
  });
});

test("an impersonating admin is the member: no one else's records", () => {
  const acting: AuthenticatedUser = {
    ...user("member", MEMBER_ID),
    impersonatedBy: ADMIN_ID,
  };
  assert.deepEqual(resolveRecordOwner(acting, undefined), {
    kind: "self",
    ownerId: MEMBER_ID,
  });
  assert.deepEqual(resolveRecordOwner(acting, ADMIN_ID), {
    kind: "redirect-self",
  });
});

test("isUserId accepts 1 to 64 letters, digits, _ and - only", () => {
  for (const good of [ADMIN_ID, "a", "A_b-9", "a".repeat(64)])
    assert.equal(isUserId(good), true, good);
  for (const bad of [
    "",
    "a".repeat(65),
    "password:abc",
    "sid:abc",
    "219588180\n",
    "a/b",
    "a.b",
    "ａ",
  ])
    assert.equal(isUserId(bad), false, JSON.stringify(bad));
});

test("only your own or, for an admin, another user's records are listed", () => {
  const admin = user("admin", ADMIN_ID);
  assert.equal(showsRecords(resolveRecordOwner(admin, undefined)), true);
  assert.equal(showsRecords(resolveRecordOwner(admin, MEMBER_ID)), true);
  assert.equal(showsRecords(resolveRecordOwner(admin, "a:b")), false);
  assert.equal(showsRecords(resolveRecordOwner(null, undefined)), false);
  assert.equal(
    showsRecords(resolveRecordOwner(user("guest", "g1"), undefined)),
    false,
  );
});
