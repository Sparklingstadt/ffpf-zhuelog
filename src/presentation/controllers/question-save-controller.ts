import { z } from "zod";

import type { SaveQuestionResult } from "@/application/chat/question-notes";
import {
  MAX_ANSWER_CHARS,
  MAX_QUESTION_CHARS,
  QUESTION_ID,
  type SaveQuestionInput,
} from "@/domain/chat/question";
import {
  isMemberRole,
  type AppRole,
} from "@/domain/identity/entities/authenticated-user";
import {
  attemptGo,
  type ActionResult,
} from "@/presentation/controllers/action-state";
import { accountForbiddenMessage } from "@/presentation/presenters/account-action-errors";
import { genericErrorMessage } from "@/presentation/presenters/generic-error-message";

const invalidNoteMessage = "質問ノートの形式が不正です。";

// The id is a lower-case UUID (crypto.randomUUID() always passes); question
// and answer are trimmed and bounded in code points. Unknown keys are
// dropped.
const inputSchema = z.object({
  id: z.string().regex(QUESTION_ID),
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

// Checks who may save and the note's shape, then saves it. Members and
// admins only; the question notes check the user again. A retry with the
// same id and content keeps one note.
export async function handleQuestionSave(
  input: unknown,
  deps: {
    getViewer: () => Promise<{ role: AppRole } | null>;
    save: (note: SaveQuestionInput) => Promise<SaveQuestionResult>;
  },
): Promise<ActionResult> {
  const user = await deps.getViewer();
  if (!user || !isMemberRole(user.role))
    return { ok: false, message: accountForbiddenMessage };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidNoteMessage };
  const attempt = await attemptGo("QUESTION_SAVE_FAILED", () =>
    deps.save(parsed.data),
  );
  if (!attempt.ok) return attempt;
  switch (attempt.value) {
    case "saved":
      return { ok: true };
    case "invalid":
      return { ok: false, message: invalidNoteMessage };
    case "conflict":
    case "unavailable":
      // conflict: the id holds other content or another owner's note;
      // crypto.randomUUID() all but never makes one. unavailable: no OpenAI.
      console.error("QUESTION_SAVE_FAILED", attempt.value);
      return { ok: false, message: genericErrorMessage };
  }
}
