import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { ConversationForbiddenError } from "@/application/chat/conversation-notes";
import { QuestionForbiddenError } from "@/application/chat/question-notes";
import { AccountAdminForbiddenError } from "@/application/identity/member-accounts";
import { LearningForbiddenError } from "@/application/learning/learning-notes";
import { LineLinkForbiddenError } from "@/application/line/line-link";
import { PracticeForbiddenError } from "@/application/practice/practice-records";
import { ReviewForbiddenError } from "@/application/review/review-queue";
import { SocialForbiddenError } from "@/application/social/social-network";
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

// What the form shows for a failure: the generic text, logging the fixed code
// with the error's name only.
function unexpectedFailureMessage(code: string, error: unknown): string {
  console.error(code, errorName(error));
  return genericErrorMessage;
}

// Runs a form action. Next's own errors (the redirect to /signin, notFound)
// are rethrown; the application's forbidden errors (see isForbidden) mean not
// allowed; anything else is logged as `code` and the error's name and gets
// the generic text.
export async function attemptAction(
  code: string,
  run: () => Promise<ActionState>,
): Promise<ActionState> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    if (isForbidden(error)) return actionUnauthorized;
    return { status: "error", message: unexpectedFailureMessage(code, error) };
  }
}

// What an action the browser calls directly (not through a form) reports.
export type ActionResult = { ok: true } | { ok: false; message: string };

// The value a call returned, or the message the user sees instead.
export type CallAttempt<T> =
  { ok: true; value: T } | { ok: false; message: string };

// Runs an action's call and keeps its value. Next's own errors are rethrown;
// the forbidden errors give accountForbiddenMessage; anything else is logged
// as `code` and the error's name and gets the generic text.
export async function attemptCall<T>(
  code: string,
  run: () => Promise<T>,
): Promise<CallAttempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    unstable_rethrow(error);
    if (isForbidden(error))
      return { ok: false, message: accountForbiddenMessage };
    return { ok: false, message: unexpectedFailureMessage(code, error) };
  }
}

// An application refusing the signed-in user: learning notes, reviews,
// practice records, questions, conversations, follows, member accounts and
// the LINE link.
function isForbidden(error: unknown): boolean {
  return (
    error instanceof LearningForbiddenError ||
    error instanceof ReviewForbiddenError ||
    error instanceof PracticeForbiddenError ||
    error instanceof QuestionForbiddenError ||
    error instanceof ConversationForbiddenError ||
    error instanceof SocialForbiddenError ||
    error instanceof AccountAdminForbiddenError ||
    error instanceof LineLinkForbiddenError
  );
}
