"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { vocabulary } from "@/composition/vocabulary-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import { VOCABULARY_LIMITS } from "@/domain/vocabulary/vocabulary-entry";
import { GoApiError } from "@/infrastructure/go-api/client";
import {
  actionSuccess,
  actionUnauthorized,
  attemptGoAction,
  goFailureMessage,
  type ActionState,
} from "@/presentation/controllers/action-state";
import { accountForbiddenMessage } from "@/presentation/presenters/account-action-errors";

type Failure = { ok: false; message: string };

async function canUseVocabulary() {
  const user = await getCurrentViewerUser();
  return Boolean(user && isMemberRole(user.role));
}

// Go's own error for bad input or a word already saved; a fixed text for the
// rest. Anything but a Go failure (including Next's redirect) is rethrown.
function failure(code: string, error: unknown): Failure {
  if (!(error instanceof GoApiError)) throw error;
  if (error.status === 403)
    return { ok: false, message: accountForbiddenMessage };
  return { ok: false, message: goFailureMessage(code, error) };
}

const draftInput = z.object({
  word: z.string().trim().min(1).max(VOCABULARY_LIMITS.word),
  sentence: z.string().trim().max(VOCABULARY_LIMITS.sentence),
});

export type DraftVocabularyResult =
  { ok: true; pinyin: string; meaning: string } | Failure;

// AI's pinyin and meaning for a word, to fill the form. Nothing is saved.
export async function draftVocabularyAction(
  input: z.input<typeof draftInput>,
): Promise<DraftVocabularyResult> {
  if (!(await canUseVocabulary()))
    return { ok: false, message: accountForbiddenMessage };
  const parsed = draftInput.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      message: `語句は1〜${VOCABULARY_LIMITS.word}文字にしてください。`,
    };
  try {
    const draft = await vocabulary.draft(
      parsed.data.word,
      parsed.data.sentence,
    );
    return { ok: true, ...draft };
  } catch (error) {
    // Without OpenAI the route is not there.
    if (
      error instanceof GoApiError &&
      (error.status === 404 || error.status === 405)
    )
      return {
        ok: false,
        message:
          "AIの下書きは今は使えません。ピンインと意味を入力してください。",
      };
    if (error instanceof GoApiError && error.status === 502)
      return {
        ok: false,
        message:
          "ピンインと意味の下書きを作れませんでした。自分で入力するか、もう一度お試しください。",
      };
    return failure("VOCABULARY_DRAFT_FAILED", error);
  }
}

const saveInput = z.object({
  id: z.uuid(),
  word: z.string().trim().min(1).max(VOCABULARY_LIMITS.word),
  pinyin: z.string().trim().max(VOCABULARY_LIMITS.pinyin),
  meaning: z.string().trim().min(1).max(VOCABULARY_LIMITS.meaning),
  sourceEntryId: z
    .string()
    .regex(/^[a-z0-9]{1,64}$/)
    .optional(),
});

export type SaveVocabularyResult = { ok: true } | Failure;

// Adds a word to the book (and to the review queue). The browser makes the
// id, so a retried save keeps one word.
export async function saveVocabularyAction(
  input: z.input<typeof saveInput>,
): Promise<SaveVocabularyResult> {
  if (!(await canUseVocabulary()))
    return { ok: false, message: accountForbiddenMessage };
  const parsed = saveInput.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      message: `語句は1〜${VOCABULARY_LIMITS.word}文字、意味は1〜${VOCABULARY_LIMITS.meaning}文字、ピンインは${VOCABULARY_LIMITS.pinyin}文字以内にしてください。`,
    };
  try {
    await vocabulary.save(parsed.data);
    revalidatePath("/vocabulary");
    return { ok: true };
  } catch (error) {
    return failure("VOCABULARY_SAVE_FAILED", error);
  }
}

// Removes a word and its review card, from the vocabulary list's button.
export async function deleteVocabularyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await canUseVocabulary())) return actionUnauthorized;
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success)
    return { status: "error", message: "単語が見つかりません。" };
  return attemptGoAction("VOCABULARY_DELETE_FAILED", async () => {
    await vocabulary.remove(id.data);
    revalidatePath("/vocabulary");
    return actionSuccess;
  });
}
