"use server";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { reviews } from "@/composition/review-container";
import type { ActionResult } from "@/presentation/controllers/action-state";
import {
  handleReviewAnswer,
  type AnswerReviewInput,
} from "@/presentation/controllers/review-answer-controller";

export type { AnswerReviewInput };
export type AnswerReviewResult = ActionResult;

// Answers one review for members and admins. A retry with the same logId is
// applied once.
export async function answerReviewAction(
  input: AnswerReviewInput,
): Promise<AnswerReviewResult> {
  // No revalidatePath: /review reads the queue on every visit, and
  // re-rendering it here would reset the open session.
  return handleReviewAnswer(input, {
    getViewer: getCurrentViewerUser,
    answer: (answer) => reviews.answer(answer),
  });
}
