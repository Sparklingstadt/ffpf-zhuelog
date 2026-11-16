"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import {
  getCurrentAdminUser,
  getCurrentMemberUser,
  memberAccounts,
} from "@/composition/identity-container";
import { clientAddress } from "@/infrastructure/auth/client-address";
import { signOutViaGo } from "@/infrastructure/go-api/go-api-session";
import { attemptGo } from "@/presentation/controllers/action-state";
import {
  accountForbiddenMessage,
  accountNotFoundMessage,
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

// Turns a failed Go call into the form's error (see attemptGo). Only fixed
// codes are logged: the form data carries plaintext passwords.
async function attemptAccountCall<T>(
  code: string,
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; state: FailedState }> {
  const attempt = await attemptGo(code, run);
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
      memberAccounts.createAccount({
        loginId: field(formData, "loginId"),
        displayName: field(formData, "displayName"),
        password: field(formData, "password"),
      }),
  );
  if (!result.ok) return result.state;
  refreshAccountList();
  return { status: "success", ...result.value };
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
  if (!result.value)
    return { status: "error", message: accountNotFoundMessage };
  refreshAccountList();
  return { status: "success", ...result.value };
}

export type ChangePasswordState =
  { status: "idle" } | { status: "error"; message: string };

export async function changeOwnPasswordAction(
  _previousState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await getCurrentMemberUser();
  if (user?.role !== "member") return forbidden;

  const clientIp = clientAddress(await headers());
  const result = await attemptAccountCall("PASSWORD_CHANGE_FAILED", () =>
    memberAccounts.changeOwnPassword(
      {
        currentPassword: field(formData, "currentPassword"),
        newPassword: field(formData, "newPassword"),
        confirmPassword: field(formData, "confirmPassword"),
      },
      clientIp,
    ),
  );
  if (!result.ok) return result.state;
  // Go has revoked every session of the member. Runs outside any try/catch:
  // signOutViaGo ends by throwing NEXT_REDIRECT.
  await signOutViaGo("/signin?notice=password-changed");
  return { status: "idle" };
}
