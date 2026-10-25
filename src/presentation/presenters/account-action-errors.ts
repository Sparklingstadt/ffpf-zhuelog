// Shown when an admin resets the password of an account that no longer
// exists (Go answers 404, which carries no message meant for the form).
// Every other account error is Go's own message or the generic text; see
// goFailureMessage.
export const accountNotFoundMessage = "アカウントが見つかりません。";

// The current account actions' "not allowed" text, kept for Go's 403.
export const accountForbiddenMessage =
  "この操作を行う権限がありません。再度ログインしてください。";
