"use server";

import { revalidatePath } from "next/cache";

import {
  getCurrentAdminUser,
  passwordAccountUseCases,
} from "@/composition/identity-container";
import { accountActionErrorMessage } from "@/presentation/presenters/account-action-errors";

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

export async function createPasswordAccountAction(
  _previousState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  if (!(await getCurrentAdminUser())) return forbidden;

  try {
    const { account, password, generated } =
      await passwordAccountUseCases.create.execute({
        loginId: field(formData, "loginId"),
        displayName: field(formData, "displayName"),
        password: field(formData, "password"),
      });
    revalidatePath("/admin/accounts");
    return { status: "success", loginId: account.loginId, password, generated };
  } catch (error) {
    return { status: "error", message: accountActionErrorMessage(error) };
  }
}

export async function resetPasswordAccountPasswordAction(
  accountId: string,
  _previousState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  if (!(await getCurrentAdminUser())) return forbidden;

  try {
    const { password, generated } = await passwordAccountUseCases.reset.execute(
      accountId,
      field(formData, "password"),
    );
    // The login ID comes from the store, not from the (client-supplied) form.
    const accounts = await passwordAccountUseCases.list.execute();
    const loginId = accounts.find((a) => a.id === accountId)?.loginId ?? "";
    revalidatePath("/admin/accounts");
    return { status: "success", loginId, password, generated };
  } catch (error) {
    return { status: "error", message: accountActionErrorMessage(error) };
  }
}
