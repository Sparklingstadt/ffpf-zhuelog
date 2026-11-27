import { isValidNewPassword } from "../../domain/identity/password-account";

// A member changes their own password from the browser through Better Auth's
// /change-password (revoking their other sessions), so Better Auth's rate
// limit counts every attempt. Better Auth itself refuses the demo account and
// an admin impersonating a member (better-auth.ts). These decide the form's
// outcome: what is refused before the request, and what each refusal means.

export type ChangePasswordFailure =
  | "forbidden"
  | "invalid-new-password"
  | "password-mismatch"
  | "invalid-current-password"
  | "error";

// The new password's length (12..128, untrimmed), then its confirmation.
export function checkNewPassword(input: {
  newPassword: string;
  confirmPassword: string;
}): ChangePasswordFailure | null {
  if (!isValidNewPassword(input.newPassword)) return "invalid-new-password";
  if (input.newPassword !== input.confirmPassword) return "password-mismatch";
  return null;
}

// Better Auth's refusal (the client's error: HTTP status and error code). A
// wrong current password and too many attempts give the same answer, so they
// cannot be told apart.
export function changePasswordFailure(error: {
  status?: number;
  code?: string;
}): ChangePasswordFailure {
  if (error.status === 429 || error.code === "INVALID_PASSWORD")
    return "invalid-current-password";
  if (error.code === "PASSWORD_TOO_SHORT" || error.code === "PASSWORD_TOO_LONG")
    return "invalid-new-password";
  if (error.status === 401 || error.status === 403) return "forbidden";
  return "error";
}
