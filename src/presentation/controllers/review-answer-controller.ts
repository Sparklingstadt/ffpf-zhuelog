import { z } from "zod";

import {
  isMemberRole,
  type AppRole,
} from "@/domain/identity/entities/authenticated-user";
import { REVIEW_LOG_ID, type ReviewRating } from "@/domain/review/review-item";
import {
  attemptCall,
  type ActionResult,
} from "@/presentation/controllers/action-state";
import { accountForbiddenMessage } from "@/presentation/presenters/account-action-errors";

// The shape only; the review queue checks the item and the owner. logId is a
// lower-case UUID as Go checked it (crypto.randomUUID() always passes).
const answerInput = z.object({
  itemId: z.string().min(1),
  logId: z.string().regex(REVIEW_LOG_ID),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});

export type AnswerReviewInput = z.infer<typeof answerInput>;

// Answers one review for members and admins; the queue checks the user
// again. A retry with the same logId is applied once.
export async function handleReviewAnswer(
  input: unknown,
  dependencies: {
    getViewer: () => Promise<{ role: AppRole } | null>;
    answer: (answer: {
      itemId: string;
      logId: string;
      rating: ReviewRating;
    }) => Promise<boolean>;
  },
): Promise<ActionResult> {
  const user = await dependencies.getViewer();
  if (!user || !isMemberRole(user.role))
    return { ok: false, message: accountForbiddenMessage };
  const parsed = answerInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "復習の回答の形式が不正です。" };
  const attempt = await attemptCall("REVIEW_ANSWER_FAILED", () =>
    dependencies.answer(parsed.data),
  );
  if (!attempt.ok) return attempt;
  return attempt.value
    ? { ok: true }
    : { ok: false, message: "この問題は復習の一覧にありません。" };
}
