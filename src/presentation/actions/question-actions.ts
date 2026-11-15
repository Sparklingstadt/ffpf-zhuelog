"use server";

import { z } from "zod";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { questionNotes } from "@/composition/question-container";
import {
  MAX_ANSWER_CHARS,
  MAX_QUESTION_CHARS,
  type SaveQuestionInput,
} from "@/domain/chat/question";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import {
  attemptGoResult,
  type ActionResult,
} from "@/presentation/controllers/action-state";
import { accountForbiddenMessage } from "@/presentation/presenters/account-action-errors";

const inputSchema = z.object({
  id: z.uuid(),
  question: z
    .string()
    .trim()
    .min(1)
    .refine((s) => [...s].length <= MAX_QUESTION_CHARS),
  answer: z
    .string()
    .trim()
    .min(1)
    .refine((s) => [...s].length <= MAX_ANSWER_CHARS),
});

// Saves a quick question and its answer as a question note, for members and
// admins; Go checks the role again. No revalidatePath: the note pages read
// Go on every visit, and it would replace the answer on screen.
export async function saveQuestionAction(
  input: SaveQuestionInput,
): Promise<ActionResult> {
  const user = await getCurrentViewerUser();
  if (!user || !isMemberRole(user.role))
    return { ok: false, message: accountForbiddenMessage };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "質問ノートの形式が不正です。" };
  return attemptGoResult("QUESTION_SAVE_FAILED", () =>
    questionNotes.save(parsed.data),
  );
}
