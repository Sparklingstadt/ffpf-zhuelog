import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentUserProvider } from "../src/application/identity/ports/current-user-provider";
import { RequireAdminUser } from "../src/application/identity/use-cases/require-admin-user";
import { RequireMemberUser } from "../src/application/identity/use-cases/require-member-user";
import { RequireViewerUser } from "../src/application/identity/use-cases/require-viewer-user";
import {
  isMemberRole,
  type AppRole,
} from "../src/domain/identity/entities/authenticated-user";

const provider = (role: AppRole | null): CurrentUserProvider => ({
  getCurrentUser: async () =>
    role ? { githubLogin: "taro", githubId: "1", role } : null,
});

test("member-level use case admits admin and member only", async () => {
  for (const [role, admitted] of [
    ["admin", true],
    ["member", true],
    ["guest", false],
    ["revoked", false],
    [null, false],
  ] as const)
    assert.equal(
      Boolean(await new RequireMemberUser(provider(role)).execute()),
      admitted,
      String(role),
    );
});

test("viewer use case admits admin, member and guest only", async () => {
  for (const [role, admitted] of [
    ["admin", true],
    ["member", true],
    ["guest", true],
    ["revoked", false],
    [null, false],
  ] as const)
    assert.equal(
      Boolean(await new RequireViewerUser(provider(role)).execute()),
      admitted,
      String(role),
    );
});

test("admin use case rejects member", async () => {
  assert.equal(await new RequireAdminUser(provider("member")).execute(), null);
  assert.ok(await new RequireAdminUser(provider("admin")).execute());
});

test("isMemberRole is true for admin and member only", () => {
  assert.equal(isMemberRole("admin"), true);
  assert.equal(isMemberRole("member"), true);
  assert.equal(isMemberRole("guest"), false);
  assert.equal(isMemberRole("revoked"), false);
});
