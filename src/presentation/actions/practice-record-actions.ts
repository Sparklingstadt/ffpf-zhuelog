"use server";

import type { z } from "zod";

import { getCurrentViewerUser } from "@/composition/identity-container";
import {
  complementRecords,
  prepositionRecords,
} from "@/composition/practice-container";
import type { ActionResult } from "@/presentation/controllers/action-state";
import {
  complementRoundInput,
  handlePracticeRoundSave,
  prepositionRoundInput,
} from "@/presentation/controllers/practice-round-controller";

export type SavePracticeRoundInput = z.infer<typeof prepositionRoundInput>;
export type SaveComplementRoundInput = z.infer<typeof complementRoundInput>;
export type SavePracticeRoundResult = ActionResult;

// No revalidatePath: the record pages are dynamic and read the database on
// every visit, and it would re-render the open result.
export async function savePrepositionRoundAction(
  input: SavePracticeRoundInput,
): Promise<SavePracticeRoundResult> {
  return handlePracticeRoundSave(input, {
    schema: prepositionRoundInput,
    code: "PREPOSITION_RECORD_SAVE_FAILED",
    getViewer: getCurrentViewerUser,
    save: (round) => prepositionRecords.save(round),
  });
}

// Complements, measure words ("measure") and 了・过・着 ("aspect") share
// one record list, told apart by mode.
export async function saveComplementRoundAction(
  input: SaveComplementRoundInput,
): Promise<SavePracticeRoundResult> {
  return handlePracticeRoundSave(input, {
    schema: complementRoundInput,
    code: "COMPLEMENT_RECORD_SAVE_FAILED",
    getViewer: getCurrentViewerUser,
    save: (round) => complementRecords.save(round),
  });
}
