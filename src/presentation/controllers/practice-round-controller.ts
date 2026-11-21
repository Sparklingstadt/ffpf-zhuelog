import { z } from "zod";

import type { SaveRoundResult } from "@/application/practice/practice-records";
import {
  isMemberRole,
  type AppRole,
} from "@/domain/identity/entities/authenticated-user";
import { COMPLEMENT_ROUND_MODES } from "@/domain/practice/complement-record";
import { PRACTICE_RECORD_ID } from "@/domain/practice/practice-round";
import { practiceAnswerInput } from "@/presentation/actions/practice-round-input";
import {
  attemptCall,
  type ActionResult,
} from "@/presentation/controllers/action-state";
import { accountForbiddenMessage } from "@/presentation/presenters/account-action-errors";
import { genericErrorMessage } from "@/presentation/presenters/generic-error-message";

const invalidRoundMessage = "練習の記録の形式が不正です。";

// The shape only; the practice records check the limits. The id is a
// lower-case UUID as Go checked it (crypto.randomUUID() always passes).
// Unknown keys are dropped, so they are never saved.
export const prepositionRoundInput = z.object({
  id: z.string().regex(PRACTICE_RECORD_ID),
  startedAt: z.iso.datetime(),
  elapsedMs: z.number().int(),
  questions: z.array(practiceAnswerInput),
});
export const complementRoundInput = prepositionRoundInput.extend({
  mode: z.enum(COMPLEMENT_ROUND_MODES),
});

// Checks who may save and the round's shape, then saves it. Members and
// admins only; the practice records check the user again. A retry with the
// same id keeps one record.
export async function handlePracticeRoundSave<T extends { startedAt: string }>(
  input: unknown,
  dependencies: {
    schema: z.ZodType<T>;
    code: string;
    getViewer: () => Promise<{ role: AppRole } | null>;
    save: (
      round: Omit<T, "startedAt"> & { startedAt: Date },
    ) => Promise<SaveRoundResult>;
  },
): Promise<ActionResult> {
  const user = await dependencies.getViewer();
  if (!user || !isMemberRole(user.role))
    return { ok: false, message: accountForbiddenMessage };
  const parsed = dependencies.schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidRoundMessage };
  const attempt = await attemptCall(dependencies.code, () =>
    dependencies.save({
      ...parsed.data,
      startedAt: new Date(parsed.data.startedAt),
    }),
  );
  if (!attempt.ok) return attempt;
  switch (attempt.value) {
    case "saved":
      return { ok: true };
    case "invalid":
      return { ok: false, message: invalidRoundMessage };
    case "taken":
      // Another owner's id; crypto.randomUUID() all but never makes one.
      console.error(dependencies.code, "taken");
      return { ok: false, message: genericErrorMessage };
  }
}
