import { RECORD_TIMEOUT_MS } from "../ai-usage/record-within";
import {
  checkQuestionNote,
  QUESTION_ID,
  QUESTION_LIST_LIMIT,
  type QuestionNote,
  type QuestionSummary,
  type SaveQuestionInput,
} from "../../domain/chat/question";
import type { AuthenticatedUser } from "../../domain/identity/entities/authenticated-user";
import type { OpenAiUsage } from "../../domain/vocabulary/vocabulary-entry";
import {
  askRefusal,
  chatPerson,
  meteredAnswer,
  type AskRefusal,
} from "./chat-user";

export type { AskRefusal } from "./chat-user";

const FEATURE = "quick_question";

// Neither a member nor an admin (signed out or a guest): there
// are no question notes to read or save.
export class QuestionForbiddenError extends Error {
  override name = "QuestionForbiddenError";
}

export type SaveQuestionResult =
  "saved" | "invalid" | "conflict" | "unavailable";
export type Asker = {
  ask(text: string, signal: AbortSignal): AsyncIterable<string>;
};

export type QuestionNotesDeps = {
  currentUser: () => Promise<AuthenticatedUser | null>;
  store: {
    list(ownerId: string, limit: number): Promise<QuestionSummary[]>;
    get(ownerId: string, id: string): Promise<QuestionNote | null>;
    save(
      ownerId: string,
      note: SaveQuestionInput,
      modelName: string,
      now: Date,
    ): Promise<boolean>;
  };
  chatModel: string | undefined; // undefined without OpenAI
  answer:
    | ((
        text: string,
        signal: AbortSignal,
        onUsage: (usage: OpenAiUsage) => void,
      ) => AsyncIterable<string>)
    | undefined; // undefined without OpenAI
  recordUsage: (
    entry: OpenAiUsage & { ownerId: string; feature: "quick_question" },
  ) => Promise<void>;
  // How long a usage write may take; RECORD_TIMEOUT_MS when unset.
  recordTimeoutMs?: number;
  // Logging belongs to the outer layers; callers pass only fixed codes and
  // error names, never the question, the answer or an error's message.
  logError: (code: string, ...details: string[]) => void;
  now: () => Date;
};

// The signed-in user's question notes and quick questions: whose notes they
// are and who pays for an answer (the member an admin impersonates), what
// the demo account may not do, and whether OpenAI is on.
export function createQuestionNotes(deps: QuestionNotesDeps) {
  async function owner(): Promise<string> {
    const found = chatPerson(await deps.currentUser());
    if (!found) throw new QuestionForbiddenError();
    return found.userId;
  }

  function askerFor(
    userId: string,
    answer: NonNullable<QuestionNotesDeps["answer"]>,
  ): Asker {
    return {
      ask: (text, signal) =>
        meteredAnswer((onUsage) => answer(text, signal, onUsage), {
          signal,
          failureCode: "QUICK_QUESTION_FAILED",
          feature: FEATURE,
          record: (usage) =>
            deps.recordUsage({
              ownerId: userId,
              feature: FEATURE,
              model: usage.model,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
            }),
          recordTimeoutMs: deps.recordTimeoutMs ?? RECORD_TIMEOUT_MS,
          logError: deps.logError,
        }),
    };
  }

  return {
    // The newest notes, without their answers. chatModel is "" without
    // OpenAI, so the page offers no way to ask.
    async list(): Promise<{ chatModel: string; questions: QuestionSummary[] }> {
      const ownerId = await owner();
      return {
        chatModel: deps.chatModel ?? "",
        questions: await deps.store.list(ownerId, QUESTION_LIST_LIMIT),
      };
    },

    // null: not one of the owner's notes.
    async get(id: string): Promise<QuestionNote | null> {
      const ownerId = await owner();
      if (!QUESTION_ID.test(id)) return null;
      return deps.store.get(ownerId, id);
    },

    // Saves the note trimmed, under the server's chat model and now. A note
    // is never changed once saved: the same id with other content (or
    // another owner's id) is a conflict.
    async save(input: SaveQuestionInput): Promise<SaveQuestionResult> {
      const ownerId = await owner();
      const note = checkQuestionNote(input);
      if (!note) return "invalid";
      if (!deps.chatModel) return "unavailable";
      const saved = await deps.store.save(
        ownerId,
        note,
        deps.chatModel,
        deps.now(),
      );
      return saved ? "saved" : "conflict";
    },

    // A way to ask, or why there is none. Checked in this order: signed
    // in, a member or admin, not the demo, OpenAI configured.
    async asker(): Promise<
      { ok: true; asker: Asker } | { ok: false; reason: AskRefusal }
    > {
      const user = await deps.currentUser();
      const refusal = askRefusal(user);
      const found = chatPerson(user);
      if (refusal || !found)
        return { ok: false, reason: refusal ?? "forbidden" };
      if (!deps.answer || !deps.chatModel)
        return { ok: false, reason: "unavailable" };
      return { ok: true, asker: askerFor(found.userId, deps.answer) };
    },
  };
}

export type QuestionNotes = ReturnType<typeof createQuestionNotes>;
