import type { ChangePasswordOutcome } from "@/application/identity/own-password";
import type { AccountInputError } from "@/domain/identity/password-account";
import { genericErrorMessage } from "@/presentation/presenters/generic-error-message";

// Shown when an admin resets the password of an account that does not exist
// (or an id no account could have). The web decides this text; it is the one
// Go's 404 carried.
export const accountNotFoundMessage = "アカウントが見つかりません。";

// The account actions' "not allowed" text.
export const accountForbiddenMessage =
  "この操作を行う権限がありません。再度ログインしてください。";

// The texts Go's 400 and 409 answers carried, unchanged on screen.
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

// The form's text for each outcome but "changed".
export function changePasswordMessage(
  outcome: Exclude<ChangePasswordOutcome, "changed">,
): string {
  switch (outcome) {
    case "forbidden":
      return accountForbiddenMessage;
    case "rate-limited":
      return genericErrorMessage;
    case "invalid-new-password":
      return passwordLengthMessage;
    case "password-mismatch":
      return passwordMismatchMessage;
    case "invalid-current-password":
      return invalidCurrentPasswordMessage;
  }
}
