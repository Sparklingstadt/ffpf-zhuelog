import { RECORD_TIMEOUT_MS, recordWithin } from "../ai-usage/record-within";
import {
  isMemberRole,
  type AuthenticatedUser,
} from "../../domain/identity/entities/authenticated-user";
import type {
  OpenAiUsage,
  VocabularyDraft,
  VocabularyEntry,
  VocabularyInput,
} from "../../domain/vocabulary/vocabulary-entry";

const DRAFT_FEATURE = "vocabulary_draft";

// Neither a member nor an admin (signed out or a guest): there is no book
// to read or change.
export class VocabularyForbiddenError extends Error {
  override name = "VocabularyForbiddenError";
}

// The store throws these: no word of the owner's under that id, or the owner
// already has the word.
export class VocabularyNotFoundError extends Error {
  override name = "VocabularyNotFoundError";
}
export class VocabularyExistsError extends Error {
  override name = "VocabularyExistsError";
}

export type VocabularyBookDeps = {
  currentUser: () => Promise<AuthenticatedUser | null>;
  store: {
    list(ownerId: string): Promise<VocabularyEntry[]>;
    save(ownerId: string, input: VocabularyInput): Promise<VocabularyEntry>;
    remove(ownerId: string, id: string): Promise<void>;
  };
  draft:
    | ((
        word: string,
        sentence: string,
        onUsage: (u: OpenAiUsage) => void,
      ) => Promise<VocabularyDraft>)
    | undefined; // undefined without OpenAI
  recordUsage: (entry: {
    ownerId: string;
    feature: "vocabulary_draft";
    model: string;
    inputTokens: number;
    outputTokens: number;
  }) => Promise<void>;
  // How long a usage write may take; RECORD_TIMEOUT_MS when unset.
  recordTimeoutMs?: number;
  // Logging belongs to the outer layers; callers pass only fixed codes and
  // error names, never the word, the sentence or an error's message.
  logError: (code: string, ...details: string[]) => void;
};

export type DraftOutcome =
  | { ok: true; draft: VocabularyDraft }
  | { ok: false; reason: "unavailable" | "forbidden" | "failed" };

type Person = { userId: string; demo: boolean };

// The signed-in user's vocabulary book: whose it is and who pays for a draft
// (the member an admin impersonates), what the demo account may not do, and
// whether AI drafts are on.
export function createVocabularyBook(deps: VocabularyBookDeps) {
  async function person(): Promise<Person | null> {
    const user = await deps.currentUser();
    if (!user || !isMemberRole(user.role)) return null;
    return { userId: user.userId, demo: user.demo === true };
  }

  async function owner(): Promise<string> {
    const found = await person();
    if (!found) throw new VocabularyForbiddenError();
    return found.userId;
  }

  // Records the tokens a draft spent, waiting at most recordTimeoutMs. A
  // failed or late write is only logged, so it never changes what the user
  // gets.
  async function record(userId: string, usage: OpenAiUsage): Promise<void> {
    await recordWithin(
      () =>
        deps.recordUsage({
          ownerId: userId,
          feature: DRAFT_FEATURE,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        }),
      deps.recordTimeoutMs ?? RECORD_TIMEOUT_MS,
      (code, name) => deps.logError(code, DRAFT_FEATURE, name),
    );
  }

  return {
    // Newest first.
    async list(): Promise<VocabularyEntry[]> {
      return deps.store.list(await owner());
    },

    async save(input: VocabularyInput): Promise<VocabularyEntry> {
      return deps.store.save(await owner(), input);
    },

    async remove(id: string): Promise<void> {
      await deps.store.remove(await owner(), id);
    },

    // AI's pinyin and meaning for word, as used in sentence. Nothing is
    // saved; the tokens spent are recorded even when the draft fails.
    async draft(word: string, sentence: string): Promise<DraftOutcome> {
      const found = await person();
      if (!found) return { ok: false, reason: "forbidden" };
      if (!deps.draft) return { ok: false, reason: "unavailable" };
      if (found.demo) return { ok: false, reason: "forbidden" };

      const spent: OpenAiUsage[] = [];
      let outcome: DraftOutcome;
      try {
        const draft = await deps.draft(word, sentence, (usage) =>
          spent.push(usage),
        );
        outcome = { ok: true, draft };
      } catch (error) {
        deps.logError("VOCABULARY_DRAFT_FAILED", errorName(error));
        outcome = { ok: false, reason: "failed" };
      }
      for (const usage of spent) await record(found.userId, usage);
      return outcome;
    },
  };
}

export type VocabularyBook = ReturnType<typeof createVocabularyBook>;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
