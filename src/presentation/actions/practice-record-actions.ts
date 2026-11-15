"use server";

import { z } from "zod";

import { getCurrentViewerUser } from "@/composition/identity-container";
import {
  complementRecords,
  prepositionRecords,
} from "@/composition/practice-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import { COMPLEMENT_ROUND_MODES } from "@/domain/practice/complement-record";
import {
  attemptGoResult,
  type ActionResult,
} from "@/presentation/controllers/action-state";
import { accountForbiddenMessage } from "@/presentation/presenters/account-action-errors";

import { practiceAnswerInput } from "./practice-round-input";

// The shape only; Go checks the limits.
const roundInput = z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  elapsedMs: z.number().int(),
  questions: z.array(practiceAnswerInput),
});
const complementRoundInput = roundInput.extend({
  mode: z.enum(COMPLEMENT_ROUND_MODES),
});

export type SavePracticeRoundInput = z.infer<typeof roundInput>;
export type SaveComplementRoundInput = z.infer<typeof complementRoundInput>;
export type SavePracticeRoundResult = ActionResult;

// Checks who may save and the round's shape, then saves it. Members and
// admins only; Go checks the role again. A retry with the same id keeps one
// record. No revalidatePath: the record pages are dynamic and read Go on
// every visit, and it would re-render the open result.
async function saveRound<T extends { startedAt: string }>(
  schema: z.ZodType<T>,
  input: unknown,
  code: string,
  save: (round: Omit<T, "startedAt"> & { startedAt: Date }) => Promise<unknown>,
): Promise<SavePracticeRoundResult> {
  const user = await getCurrentViewerUser();
  if (!user || !isMemberRole(user.role))
    return { ok: false, message: accountForbiddenMessage };
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "練習の記録の形式が不正です。" };
  return attemptGoResult(code, async () => {
    await save({
      ...parsed.data,
      startedAt: new Date(parsed.data.startedAt),
    });
  });
}

export async function savePrepositionRoundAction(
  input: SavePracticeRoundInput,
): Promise<SavePracticeRoundResult> {
  return saveRound(
    roundInput,
    input,
    "PREPOSITION_RECORD_SAVE_FAILED",
    (round) => prepositionRecords.save(round),
  );
}

// Complements, measure words ("measure") and 了・过・着 ("aspect") share
// one record list, told apart by mode.
export async function saveComplementRoundAction(
  input: SaveComplementRoundInput,
): Promise<SavePracticeRoundResult> {
  return saveRound(
    complementRoundInput,
    input,
    "COMPLEMENT_RECORD_SAVE_FAILED",
    (round) => complementRecords.save(round),
  );
}
