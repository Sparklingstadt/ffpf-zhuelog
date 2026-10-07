import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AppRole,
  AuthenticatedUser,
} from "../src/domain/identity/entities/authenticated-user";
import { isOwnerId } from "../src/domain/identity/owner-id";
import { resolveRecordOwner } from "../src/application/identity/use-cases/resolve-record-owner";

const ADMIN_ID = "219588180";
const MEMBER_ID = "password:ckabcdefghijklmnopqrstuvw";

const user = (role: AppRole, githubId?: string): AuthenticatedUser => ({
  githubLogin: "taro",
  role,
  ...(githubId ? { githubId } : {}),
});

test("unauthenticated, guest, revoked and ownerless users are denied", () => {
  assert.deepEqual(resolveRecordOwner(null, undefined), {
    kind: "denied",
    reason: "unauthenticated",
  });
  assert.deepEqual(resolveRecordOwner(user("guest", "1"), undefined), {
    kind: "denied",
    reason: "guest",
  });
  assert.deepEqual(resolveRecordOwner(user("revoked", "1"), undefined), {
    kind: "denied",
    reason: "unauthenticated",
  });
  assert.deepEqual(resolveRecordOwner(user("admin"), undefined), {
    kind: "denied",
    reason: "reauth",
  });
});

test("admin sees self by default and may view well-formed other owners", () => {
  const admin = user("admin", ADMIN_ID);
  const self = { kind: "self", ownerId: ADMIN_ID };
  assert.deepEqual(resolveRecordOwner(admin, undefined), self);
  assert.deepEqual(resolveRecordOwner(admin, ""), self);
  assert.deepEqual(resolveRecordOwner(admin, ADMIN_ID), self);
  assert.deepEqual(resolveRecordOwner(admin, MEMBER_ID), {
    kind: "other",
    ownerId: MEMBER_ID,
  });
  assert.deepEqual(resolveRecordOwner(admin, "42"), {
    kind: "other",
    ownerId: "42",
  });
});

test("admin with a malformed owner id is sent back to self", () => {
  const admin = user("admin", ADMIN_ID);
  for (const bad of ["../x", "password:ABC"])
    assert.deepEqual(resolveRecordOwner(admin, bad), {
      kind: "redirect-self",
    });
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

test("isOwnerId accepts GitHub ids and password owner ids only", () => {
  assert.equal(isOwnerId(ADMIN_ID), true);
  assert.equal(isOwnerId(MEMBER_ID), true);
  for (const bad of ["password:", "219588180\n", "abc"])
    assert.equal(isOwnerId(bad), false, JSON.stringify(bad));
});
