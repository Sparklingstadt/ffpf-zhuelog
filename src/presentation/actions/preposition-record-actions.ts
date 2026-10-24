"use server";

import { z } from "zod";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { prepositionRecords } from "@/composition/practice-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import { GoApiError } from "@/infrastructure/go-api/client";
import { goFailureMessage } from "@/presentation/controllers/action-state";
import { accountForbiddenMessage } from "@/presentation/presenters/account-action-errors";

// The shape only; Go checks the limits.
const roundInput = z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  elapsedMs: z.number().int(),
  questions: z.array(
    z.object({
      answer: z.string(),
      noun: z.string(),
      prompt: z.string(),
      misses: z.array(z.string()),
    }),
  ),
});

export type SavePrepositionRoundInput = z.infer<typeof roundInput>;
export type SavePrepositionRoundResult =
  { ok: true } | { ok: false; message: string };

// Saves a finished round for members and admins; Go checks the role again.
// A retry with the same id keeps one record.
export async function savePrepositionRoundAction(
  input: SavePrepositionRoundInput,
): Promise<SavePrepositionRoundResult> {
  const user = await getCurrentViewerUser();
  if (!user || !isMemberRole(user.role))
    return { ok: false, message: accountForbiddenMessage };
  const parsed = roundInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "練習の記録の形式が不正です。" };
  try {
    await prepositionRecords.save({
      ...parsed.data,
      startedAt: new Date(parsed.data.startedAt),
    });
    // No revalidatePath: the record pages are dynamic and read Go on every
    // visit, and it would re-render the open result.
    return { ok: true };
  } catch (error) {
    // Anything but a Go failure (including Next's redirect) is rethrown.
    if (!(error instanceof GoApiError)) throw error;
    if (error.status === 403)
      return { ok: false, message: accountForbiddenMessage };
    return {
      ok: false,
      message: goFailureMessage("PREPOSITION_RECORD_SAVE_FAILED", error),
    };
  }
}
