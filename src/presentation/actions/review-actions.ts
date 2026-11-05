"use server";

import { z } from "zod";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { reviews } from "@/composition/review-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import { GoApiError } from "@/infrastructure/go-api/client";
import { goFailureMessage } from "@/presentation/controllers/action-state";
import { accountForbiddenMessage } from "@/presentation/presenters/account-action-errors";

// The shape only; Go checks the item and the owner.
const answerInput = z.object({
  itemId: z.string().min(1),
  logId: z.uuid(),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});

export type AnswerReviewInput = z.infer<typeof answerInput>;
export type AnswerReviewResult = { ok: true } | { ok: false; message: string };

// Answers one review for members and admins; Go checks the role again. A
// retry with the same logId is applied once.
export async function answerReviewAction(
  input: AnswerReviewInput,
): Promise<AnswerReviewResult> {
  const user = await getCurrentViewerUser();
  if (!user || !isMemberRole(user.role))
    return { ok: false, message: accountForbiddenMessage };
  const parsed = answerInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "復習の回答の形式が不正です。" };
  try {
    await reviews.answer(parsed.data);
    // No revalidatePath: /review reads Go on every visit, and re-rendering
    // it here would reset the open session.
    return { ok: true };
  } catch (error) {
    // Anything but a Go failure (including Next's redirect) is rethrown.
    if (!(error instanceof GoApiError)) throw error;
    if (error.status === 403)
      return { ok: false, message: accountForbiddenMessage };
    if (error.status === 404)
      return { ok: false, message: "この問題は復習の一覧にありません。" };
    return {
      ok: false,
      message: goFailureMessage("REVIEW_ANSWER_FAILED", error),
    };
  }
}
