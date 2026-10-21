import { z } from "zod";

import { GoApiError } from "@/infrastructure/go-api/client";
import { genericErrorMessage } from "@/presentation/presenters/generic-error-message";

// What a one-button Server Action reports back to its form.
export type ActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const actionSuccess: ActionState = { status: "success", message: "" };
export const actionUnauthorized: ActionState = {
  status: "error",
  message: "ログインし直してください。",
};
const actionFailed: ActionState = {
  status: "error",
  message: genericErrorMessage,
};

// Learning note ids are Prisma cuids (seeded test notes use other lowercase
// alphanumerics).
export const noteIdSchema = z.string().regex(/^[a-z0-9]{1,64}$/);

// Runs the action, turning any thrown error into the generic failure. Logs
// a fixed code only: never a member's name or a note's text.
export async function attemptAction(
  code: string,
  run: () => Promise<ActionState>,
): Promise<ActionState> {
  try {
    return await run();
  } catch {
    console.error(code);
    return actionFailed;
  }
}

// Go error codes (400, 409 and 413) whose message is meant for the user to
// act on.
const userFacingCodes = new Set([
  "invalid_request",
  "invalid_csv",
  "password_mismatch",
  "invalid_current_password",
  "login_id_taken",
  "too_large",
]);

// Runs an action that calls the Go API. Only a GoApiError becomes a state:
// anything else, including Next's redirect to /signin, is rethrown. 403 is
// treated as not being allowed; Go's own message is shown for bad input,
// and every other failure (429, 5xx, Go unreachable) gets the generic text.
// Logs the fixed code with Go's status and error code only.
export async function attemptGoAction(
  code: string,
  run: () => Promise<ActionState>,
): Promise<ActionState> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof GoApiError)) throw error;
    if (error.status === 403) return actionUnauthorized;
    if (
      [400, 409, 413].includes(error.status) &&
      userFacingCodes.has(error.code) &&
      error.userMessage
    )
      return { status: "error", message: error.userMessage };
    console.error(code, error.status, error.code);
    return actionFailed;
  }
}
