import assert from "node:assert/strict";
import { test } from "node:test";

import {
  changePasswordFailure,
  checkNewPassword,
} from "../src/application/identity/own-password";

// A member's own password change goes to Better Auth's /change-password from
// the browser (so its rate limit counts it). These decide what the form says
// before the request and for each refusal.

test("the new password is checked for length, then against its confirmation", () => {
  assert.equal(
    checkNewPassword({ newPassword: "short", confirmPassword: "short" }),
    "invalid-new-password",
  );
  assert.equal(
    checkNewPassword({
      newPassword: "x".repeat(129),
      confirmPassword: "x".repeat(129),
    }),
    "invalid-new-password",
  );
  assert.equal(
    checkNewPassword({
      newPassword: "member-password-2",
      confirmPassword: "member-password-3",
    }),
    "password-mismatch",
  );
  assert.equal(
    checkNewPassword({
      newPassword: " spaces kept 1 ",
      confirmPassword: " spaces kept 1 ",
    }),
    null,
  );
});

test("each refusal from Better Auth has one outcome", () => {
  const cases = [
    // A wrong current password and too many attempts read the same.
    [{ status: 400, code: "INVALID_PASSWORD" }, "invalid-current-password"],
    [{ status: 429 }, "invalid-current-password"],
    [{ status: 400, code: "PASSWORD_TOO_SHORT" }, "invalid-new-password"],
    [{ status: 400, code: "PASSWORD_TOO_LONG" }, "invalid-new-password"],
    // Signed out meanwhile, the demo account, an admin impersonating.
    [{ status: 401 }, "forbidden"],
    [{ status: 403 }, "forbidden"],
    // No password here (a Sparklingstadt ID member) and anything else.
    [{ status: 400, code: "CREDENTIAL_ACCOUNT_NOT_FOUND" }, "error"],
    [{ status: 500 }, "error"],
    [{}, "error"],
  ] as const;
  for (const [error, outcome] of cases)
    assert.equal(changePasswordFailure(error), outcome, JSON.stringify(error));
});
