import { ZodError } from "zod";

import {
  LoginIdTakenError,
  PasswordAccountNotFoundError,
} from "@ffpf-zhuelog/core/domain/identity/password-account-error";

export const accountActionFallbackMessage =
  "処理できませんでした。時間をおいてもう一度お試しください。";

const fieldMessages: Record<string, string> = {
  loginId: "ログインIDは英小文字・数字・. _ - の3〜32文字にしてください。",
  displayName: "表示名は1〜50文字にしてください。",
  password: "パスワードは12〜128文字にしてください。",
};

// Errors the admin can act on (bad input, duplicate ID, missing account), as
// opposed to unexpected failures such as a database outage.
export function isExpectedAccountActionError(error: unknown): boolean {
  return (
    error instanceof ZodError ||
    error instanceof LoginIdTakenError ||
    error instanceof PasswordAccountNotFoundError
  );
}

// The use cases validate with one z.object, so the first issue's path[0] names
// the offending field. Anything unrecognised gets a generic message that never
// echoes the error (it could carry input or infrastructure details).
export function accountActionErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    const field = error.issues[0]?.path[0];
    return (
      (typeof field === "string" ? fieldMessages[field] : undefined) ??
      accountActionFallbackMessage
    );
  }
  if (error instanceof LoginIdTakenError) {
    return "このログインIDはすでに使われています。";
  }
  if (error instanceof PasswordAccountNotFoundError) {
    return "アカウントが見つかりません。";
  }
  return accountActionFallbackMessage;
}
