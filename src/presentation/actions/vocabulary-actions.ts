"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import {
  VocabularyForbiddenError,
  type DraftOutcome,
} from "@/application/vocabulary/vocabulary-book";
import { getCurrentViewerUser } from "@/composition/identity-container";
import { vocabulary } from "@/composition/vocabulary-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import { VOCABULARY_LIMITS } from "@/domain/vocabulary/vocabulary-entry";
import {
  VocabularyExistsError,
  VocabularyNotFoundError,
} from "@/infrastructure/prisma/vocabulary-store";
import {
  actionSuccess,
  actionUnauthorized,
  type ActionState,
} from "@/presentation/controllers/action-state";
import { lowercaseUuid } from "@/presentation/actions/vocabulary-id";
import { accountForbiddenMessage } from "@/presentation/presenters/account-action-errors";
import { genericErrorMessage } from "@/presentation/presenters/generic-error-message";

type Failure = { ok: false; message: string };

const notFoundMessage = "単語が見つかりません。";
const existsMessage = "この語句はすでに単語帳にあります。";
const draftUnavailableMessage =
  "AIの下書きは今は使えません。ピンインと意味を入力してください。";
const draftFailedMessage =
  "ピンインと意味の下書きを作れませんでした。自分で入力するか、もう一度お試しください。";

async function canUseVocabulary() {
  const user = await getCurrentViewerUser();
  return Boolean(user && isMemberRole(user.role));
}

// The text for a failure the user cannot act on. Next's own errors (redirect,
// notFound) are rethrown; the rest is logged by code and error name only.
function unexpected(code: string, error: unknown): string {
  unstable_rethrow(error);
  console.error(code, error instanceof Error ? error.name : typeof error);
  return genericErrorMessage;
}

// What a failed save tells the user.
function saveFailure(error: unknown): Failure {
  if (error instanceof VocabularyExistsError)
    return { ok: false, message: existsMessage };
  if (error instanceof VocabularyNotFoundError)
    return { ok: false, message: notFoundMessage };
  if (error instanceof VocabularyForbiddenError)
    return { ok: false, message: accountForbiddenMessage };
  return { ok: false, message: unexpected("VOCABULARY_SAVE_FAILED", error) };
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
  let outcome: DraftOutcome;
  try {
    outcome = await vocabulary.draft(parsed.data.word, parsed.data.sentence);
  } catch (error) {
    return {
      ok: false,
      message: unexpected("VOCABULARY_DRAFT_FAILED", error),
    };
  }
  if (outcome.ok) return { ok: true, ...outcome.draft };
  const message = {
    unavailable: draftUnavailableMessage,
    failed: draftFailedMessage,
    forbidden: accountForbiddenMessage,
  }[outcome.reason];
  return { ok: false, message };
}

const saveInput = z.object({
  id: lowercaseUuid,
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
    return saveFailure(error);
  }
}

// Removes a word and its review card, from the vocabulary list's button.
export async function deleteVocabularyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await canUseVocabulary())) return actionUnauthorized;
  const id = lowercaseUuid.safeParse(formData.get("id"));
  if (!id.success) return { status: "error", message: notFoundMessage };
  try {
    await vocabulary.remove(id.data);
  } catch (error) {
    if (error instanceof VocabularyNotFoundError)
      return { status: "error", message: notFoundMessage };
    if (error instanceof VocabularyForbiddenError) return actionUnauthorized;
    return {
      status: "error",
      message: unexpected("VOCABULARY_DELETE_FAILED", error),
    };
  }
  revalidatePath("/vocabulary");
  return actionSuccess;
}
