"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { memberAccounts, ownPassword } from "@/composition/account-container";
import {
  getCurrentAdminUser,
  getCurrentMemberUser,
  signOutTo,
} from "@/composition/identity-container";
import { clientAddress } from "@/infrastructure/auth/client-address";
import { attemptCall } from "@/presentation/controllers/action-state";
import {
  accountForbiddenMessage,
  accountInputMessage,
  accountNotFoundMessage,
  changePasswordMessage,
} from "@/presentation/presenters/account-action-errors";

export type AccountActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "success";
      loginId: string;
      password: string;
      generated: boolean;
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
  return { status: "success", ...result.value.issued };
}

export type ChangePasswordState =
  { status: "idle" } | { status: "error"; message: string };

export async function changeOwnPasswordAction(
  _previousState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await getCurrentMemberUser();
  if (user?.role !== "member") return forbidden;

  const client = clientAddress(await headers());
  const result = await attemptAccountCall("PASSWORD_CHANGE_FAILED", () =>
    ownPassword.change(
      {
        currentPassword: field(formData, "currentPassword"),
        newPassword: field(formData, "newPassword"),
        confirmPassword: field(formData, "confirmPassword"),
      },
      client,
    ),
  );
  if (!result.ok) return result.state;
  const outcome = result.value;
  if (outcome === "rate-limited") console.error("PASSWORD_CHANGE_RATE_LIMITED");
  if (outcome !== "changed")
    return { status: "error", message: changePasswordMessage(outcome) };
  // The change already deleted every Session row of the member; signOutTo
  // clears this browser's cookies. Runs outside any try/catch: signOutTo
  // ends by throwing NEXT_REDIRECT.
  await signOutTo("/signin?notice=password-changed");
  return { status: "idle" };
}
