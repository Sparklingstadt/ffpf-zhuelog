"use server";

import { revalidatePath } from "next/cache";

import {
  getCurrentAdminUser,
  passwordAccountUseCases,
} from "@/composition/identity-container";
import {
  accountActionErrorMessage,
  isExpectedAccountActionError,
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

const forbidden: AccountActionState = {
  status: "error",
  message: "この操作を行う権限がありません。再度ログインしてください。",
};

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// Logs a fixed code only: the error, its message and the form data may carry
// a plaintext password.
function failure(error: unknown): AccountActionState {
  if (!isExpectedAccountActionError(error)) {
    console.error("PASSWORD_ACCOUNT_ACTION_FAILED");
  }
  return { status: "error", message: accountActionErrorMessage(error) };
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

  let result;
  try {
    result = await passwordAccountUseCases.create.execute({
      loginId: field(formData, "loginId"),
      displayName: field(formData, "displayName"),
      password: field(formData, "password"),
    });
  } catch (error) {
    return failure(error);
  }
  refreshAccountList();
  return {
    status: "success",
    loginId: result.account.loginId,
    password: result.password,
    generated: result.generated,
  };
}

export async function resetPasswordAccountPasswordAction(
  accountId: string,
  _previousState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  if (!(await getCurrentAdminUser())) return forbidden;

  let result;
  try {
    result = await passwordAccountUseCases.reset.execute(
      accountId,
      field(formData, "password"),
    );
  } catch (error) {
    return failure(error);
  }
  refreshAccountList();
  return { status: "success", ...result };
}
