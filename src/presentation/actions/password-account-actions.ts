"use server";

import { revalidatePath } from "next/cache";

import { memberAccounts } from "@/composition/account-container";
import {
  getCurrentAdminUser,
  signOutTo,
} from "@/composition/identity-container";
import { attemptCall } from "@/presentation/controllers/action-state";
import { errorName } from "@/presentation/controllers/load-or";
import {
  accountForbiddenMessage,
  accountInputMessage,
  accountNotFoundMessage,
  sessionsNotEndedMessage,
} from "@/presentation/presenters/account-action-errors";

export type AccountActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "success";
      loginId: string;
      password: string;
      generated: boolean;
      // Said next to the password when something after the change failed.
      notice?: string;
    };

const forbidden = {
  status: "error" as const,
  message: accountForbiddenMessage,
};

type FailedState = { status: "error"; message: string };

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// Turns a failed account call (the database, a hash, or an admin-only refusal)
// into the form's error (see attemptCall). Only fixed codes and error names
// are logged: the form data carries plaintext passwords.
async function attemptAccountCall<T>(
  code: string,
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; state: FailedState }> {
  const attempt = await attemptCall(code, run);
  return attempt.ok
    ? attempt
    : { ok: false, state: { status: "error", message: attempt.message } };
}

// The mutation has already succeeded, and the one-time password must still
// reach the admin, so a failed refresh is logged (code only) and ignored.
function refreshAccountList() {
  try {
    revalidatePath("/admin/accounts");
  } catch {
    console.error("PASSWORD_ACCOUNT_REVALIDATE_FAILED");
  }
}

export async function createPasswordAccountAction(
  _previousState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  if (!(await getCurrentAdminUser())) return forbidden;

  const result = await attemptAccountCall(
    "PASSWORD_ACCOUNT_CREATE_FAILED",
    () =>
      memberAccounts.create({
        loginId: field(formData, "loginId"),
        displayName: field(formData, "displayName"),
        password: field(formData, "password"),
      }),
  );
  if (!result.ok) return result.state;
  if (!result.value.ok)
    return {
      status: "error",
      message: accountInputMessage(result.value.reason),
    };
  refreshAccountList();
  return { status: "success", ...result.value.issued };
}

// accountId is the member's user id.
export async function resetPasswordAccountPasswordAction(
  accountId: string,
  _previousState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  if (!(await getCurrentAdminUser())) return forbidden;

  const result = await attemptAccountCall("PASSWORD_ACCOUNT_RESET_FAILED", () =>
    memberAccounts.resetPassword(accountId, field(formData, "password")),
  );
  if (!result.ok) return result.state;
  if (!result.value.ok)
    return {
      status: "error",
      message:
        result.value.reason === "password"
          ? accountInputMessage("password")
          : accountNotFoundMessage,
    };
  refreshAccountList();
  if (!result.value.sessionsEnded) {
    console.error(
      "PASSWORD_ACCOUNT_REVOKE_SESSIONS_FAILED",
      errorName(result.value.sessionsError),
    );
    return {
      status: "success",
      ...result.value.issued,
      notice: sessionsNotEndedMessage,
    };
  }
  return { status: "success", ...result.value.issued };
}

// After a member's own password change (Better Auth's /change-password from
// the browser, which already ended every other session of theirs): signs
// this browser out too and goes to the sign-in page. Ends by throwing
// NEXT_REDIRECT.
export async function signOutAfterPasswordChangeAction(): Promise<void> {
  await signOutTo("/signin?notice=password-changed");
}
