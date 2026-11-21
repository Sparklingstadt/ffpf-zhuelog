import { RECORD_TIMEOUT_MS, recordWithin } from "../ai-usage/record-within";
import {
  checkQuestionNote,
  QUESTION_ID,
  QUESTION_LIST_LIMIT,
  type QuestionNote,
  type QuestionSummary,
  type SaveQuestionInput,
} from "../../domain/chat/question";
import {
  isMemberRole,
  type AuthenticatedUser,
} from "../../domain/identity/entities/authenticated-user";
import type { OpenAiUsage } from "../../domain/vocabulary/vocabulary-entry";

const FEATURE = "quick_question";

// Neither a member nor an admin (signed out, a guest or no githubId): there
// are no question notes to read or save.
export class QuestionForbiddenError extends Error {
  override name = "QuestionForbiddenError";
}

export type SaveQuestionResult =
  "saved" | "invalid" | "conflict" | "unavailable";
export type AskRefusal = "signed-out" | "forbidden" | "demo" | "unavailable";
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

type Person = { ownerId: string; actorId: string; demo: boolean };

// The signed-in user's question notes and quick questions: whose notes they
// are (the member an admin acts as), who pays for an answer (the admin
// themself), what the demo account may not do, and whether OpenAI is on.
export function createQuestionNotes(deps: QuestionNotesDeps) {
  // ownerId is whose notes these are; actorId is who is operating (the
  // admin themself while acting as a member), who pays for an answer.
  function person(user: AuthenticatedUser | null): Person | null {
    if (!user || !isMemberRole(user.role) || !user.githubId) return null;
    return {
      ownerId: user.githubId,
      actorId: user.actorId ?? user.githubId,
      demo: user.demo === true,
    };
  }

  async function owner(): Promise<string> {
    const found = person(await deps.currentUser());
    if (!found) throw new QuestionForbiddenError();
    return found.ownerId;
  }

  // Records the tokens an answer spent, waiting at most recordTimeoutMs. A
  // failed or late write is only logged, so it never changes what the user
  // gets.
  async function record(actorId: string, usage: OpenAiUsage): Promise<void> {
    await recordWithin(
      () =>
        deps.recordUsage({
          ownerId: actorId,
          feature: FEATURE,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        }),
      deps.recordTimeoutMs ?? RECORD_TIMEOUT_MS,
      (code, name) => deps.logError(code, FEATURE, name),
    );
  }

  function askerFor(
    actorId: string,
    answer: NonNullable<QuestionNotesDeps["answer"]>,
  ): Asker {
    return {
      // The answer's pieces. The usage is recorded before the answer ends or
      // fails (Go wrote it before the last line), and also when the caller
      // stops early.
      async *ask(text, signal) {
        const spent: OpenAiUsage[] = [];
        try {
          yield* answer(text, signal, (usage) => spent.push(usage));
        } catch (error) {
          // An answer the browser stopped is not a failure worth logging.
          if (!signal.aborted)
            deps.logError("QUICK_QUESTION_FAILED", failureCode(error));
          throw error;
        } finally {
          for (const usage of spent) await record(actorId, usage);
        }
      },
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

    // A way to ask, or why there is none. Checked in Go's order: signed in,
    // a member or admin, not the demo, OpenAI configured.
    async asker(): Promise<
      { ok: true; asker: Asker } | { ok: false; reason: AskRefusal }
    > {
      const user = await deps.currentUser();
      if (!user) return { ok: false, reason: "signed-out" };
      const found = person(user);
      if (!found) return { ok: false, reason: "forbidden" };
      if (found.demo) return { ok: false, reason: "demo" };
      if (!deps.answer || !deps.chatModel)
        return { ok: false, reason: "unavailable" };
      return { ok: true, asker: askerFor(found.actorId, deps.answer) };
    },
  };
}

export type QuestionNotes = ReturnType<typeof createQuestionNotes>;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

// OpenAI's error code (the whole message of its errors), else the error's
// name: application code does not import the infrastructure's error class.
function failureCode(error: unknown): string {
  if (error instanceof Error && /^OPENAI_[A-Z_]+$/.test(error.message))
    return error.message;
  return errorName(error);
}
