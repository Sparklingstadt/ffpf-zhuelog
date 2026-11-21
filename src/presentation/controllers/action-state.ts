import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { LearningForbiddenError } from "@/application/learning/learning-notes";
import { PracticeForbiddenError } from "@/application/practice/practice-records";
import { ReviewForbiddenError } from "@/application/review/review-queue";
import { GoApiError } from "@/infrastructure/go-api/client";
import { errorName } from "@/presentation/controllers/load-or";
import { accountForbiddenMessage } from "@/presentation/presenters/account-action-errors";
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

// Learning note ids are Prisma cuids (seeded test notes use other lowercase
// alphanumerics).
export const noteIdSchema = z.string().regex(/^[a-z0-9]{1,64}$/);

// Go error codes (400, 409 and 413) whose message is meant for the user to
// act on.
const userFacingCodes = new Set([
  "invalid_request",
  "password_mismatch",
  "invalid_current_password",
  "login_id_taken",
  "vocabulary_exists",
  "too_large",
]);

// What the form shows for a failed Go call: Go's own message for bad input,
// the generic text for every other failure (429, 5xx, Go unreachable). The
// generic case logs the fixed code with Go's status and error code only.
export function goFailureMessage(code: string, error: GoApiError): string {
  if (
    [400, 409, 413].includes(error.status) &&
    userFacingCodes.has(error.code) &&
    error.userMessage
  )
    return error.userMessage;
  console.error(code, error.status, error.code);
  return genericErrorMessage;
}

// What the form shows for a failure that is not Go's: the generic text,
// logging the fixed code with the error's name only.
function unexpectedFailureMessage(code: string, error: unknown): string {
  console.error(code, errorName(error));
  return genericErrorMessage;
}

// Runs an action that calls the Go API or the database. Next's own errors
// (the redirect to /signin, notFound) are rethrown. Go's 403,
// LearningForbiddenError, ReviewForbiddenError and PracticeForbiddenError are
// treated as not being allowed; other Go failures go through
// goFailureMessage, anything else gets the generic text.
export async function attemptGoAction(
  code: string,
  run: () => Promise<ActionState>,
): Promise<ActionState> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    if (isForbidden(error)) return actionUnauthorized;
    const message =
      error instanceof GoApiError
        ? goFailureMessage(code, error)
        : unexpectedFailureMessage(code, error);
    return { status: "error", message };
  }
}

// What an action the browser calls directly (not through a form) reports.
export type ActionResult = { ok: true } | { ok: false; message: string };

// The value a Go call returned, or the message the user sees instead.
export type GoAttempt<T> =
  { ok: true; value: T } | { ok: false; message: string };

// Runs an action's Go or database call and keeps its value. Next's own
// errors are rethrown. Go's 403, LearningForbiddenError,
// ReviewForbiddenError and PracticeForbiddenError mean not allowed; a Go 404
// gets `notFound` when the action gives one; other Go failures go through
// goFailureMessage and anything else gets the generic text, logging codes
// and error names only.
export async function attemptGo<T>(
  code: string,
  run: () => Promise<T>,
  { notFound }: { notFound?: string } = {},
): Promise<GoAttempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    unstable_rethrow(error);
    if (isForbidden(error))
      return { ok: false, message: accountForbiddenMessage };
    if (!(error instanceof GoApiError))
      return { ok: false, message: unexpectedFailureMessage(code, error) };
    if (error.status === 404 && notFound)
      return { ok: false, message: notFound };
    return { ok: false, message: goFailureMessage(code, error) };
  }
}

// attemptGo for an action that only reports whether it worked.
export async function attemptGoResult(
  code: string,
  run: () => Promise<unknown>,
  options: { notFound?: string } = {},
): Promise<ActionResult> {
  const attempt = await attemptGo(code, run, options);
  return attempt.ok ? { ok: true } : attempt;
}

function isForbidden(error: unknown): boolean {
  return (
    error instanceof LearningForbiddenError ||
    error instanceof ReviewForbiddenError ||
    error instanceof PracticeForbiddenError ||
    (error instanceof GoApiError && error.status === 403)
  );
}
