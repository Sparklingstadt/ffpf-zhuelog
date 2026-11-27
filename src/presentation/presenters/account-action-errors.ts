import type { ChangePasswordFailure } from "@/application/identity/own-password";
import type { AccountInputError } from "@/domain/identity/password-account";
import { genericErrorMessage } from "@/presentation/presenters/generic-error-message";

// Shown when an admin resets the password of an account that does not exist
// (or an id no account could have).
export const accountNotFoundMessage = "アカウントが見つかりません。";

// Shown with the new password when the reset could not end the member's
// sessions.
export const sessionsNotEndedMessage =
  "パスワードは再設定しましたが、ほかの端末ではログインしたままの可能性があります。";

// The account actions' "not allowed" text.
export const accountForbiddenMessage =
  "この操作を行う権限がありません。再度ログインしてください。";

// The texts for input the account actions refuse.
const loginIdMessage =
  "ログインIDは英小文字・数字・. _ - の3〜32文字にしてください。";
const displayNameMessage = "表示名は1〜50文字にしてください。";
const passwordLengthMessage = "パスワードは12〜128文字にしてください。";
const loginIdTakenMessage = "このログインIDはすでに使われています。";
const passwordMismatchMessage = "確認用のパスワードが一致しません。";
const invalidCurrentPasswordMessage =
  "現在のパスワードが違うか、一時的にロックされています。";

export function accountInputMessage(
  reason: AccountInputError | "login-id-taken",
): string {
  switch (reason) {
    case "login-id":
      return loginIdMessage;
    case "display-name":
      return displayNameMessage;
    case "password":
      return passwordLengthMessage;
    case "login-id-taken":
      return loginIdTakenMessage;
  }
}

// The password change form's text for each failure.
export function changePasswordMessage(failure: ChangePasswordFailure): string {
  switch (failure) {
    case "forbidden":
      return accountForbiddenMessage;
    case "error":
      return genericErrorMessage;
    case "invalid-new-password":
      return passwordLengthMessage;
    case "password-mismatch":
      return passwordMismatchMessage;
    case "invalid-current-password":
      return invalidCurrentPasswordMessage;
  }
}
