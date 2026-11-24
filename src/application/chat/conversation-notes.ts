import { RECORD_TIMEOUT_MS } from "../ai-usage/record-within";
import {
  checkConversation,
  CONVERSATION_ID,
  CONVERSATION_LIST_LIMIT,
  type ChatTurn,
  type CheckedConversation,
  type Conversation,
  type ConversationSummary,
  type SaveConversationInput,
} from "../../domain/chat/conversation";
import type { AuthenticatedUser } from "../../domain/identity/entities/authenticated-user";
import type { OpenAiUsage } from "../../domain/vocabulary/vocabulary-entry";
import {
  askRefusal,
  chatPerson,
  meteredAnswer,
  type AskRefusal,
} from "./chat-user";

export type { AskRefusal } from "./chat-user";

const FEATURE = "chat";

// Neither a member nor an admin (signed out, a guest or no githubId): there
// are no conversations to read, save or remove.
export class ConversationForbiddenError extends Error {
  override name = "ConversationForbiddenError";
}

export type SaveConversationResult =
  "saved" | "invalid" | "conflict" | "unavailable";
export type Chatter = {
  ask(turns: readonly ChatTurn[], signal: AbortSignal): AsyncIterable<string>;
};

export type ConversationNotesDeps = {
  currentUser: () => Promise<AuthenticatedUser | null>;
  store: {
    list(ownerId: string, limit: number): Promise<ConversationSummary[]>;
    get(ownerId: string, id: string): Promise<Conversation | null>;
    save(
      ownerId: string,
      conversation: CheckedConversation,
      now: Date,
    ): Promise<boolean>;
    remove(ownerId: string, id: string): Promise<boolean>;
  };
  chatModel: string | undefined; // undefined without OpenAI
  answer:
    | ((
        turns: readonly ChatTurn[],
        signal: AbortSignal,
        onUsage: (usage: OpenAiUsage) => void,
      ) => AsyncIterable<string>)
    | undefined; // undefined without OpenAI
  recordUsage: (
    entry: OpenAiUsage & { ownerId: string; feature: "chat" },
  ) => Promise<void>;
  // How long a usage write may take; RECORD_TIMEOUT_MS when unset.
  recordTimeoutMs?: number;
  // Logging belongs to the outer layers; callers pass only fixed codes and
  // error names, never a message's text or an error's message.
  logError: (code: string, ...details: string[]) => void;
  now: () => Date;
};

// The signed-in user's saved conversations and chats with ChatGPT: whose
// conversations they are (the member an admin acts as), who pays for an
// answer (the admin themself), what the demo account may not do (chat), and
// whether OpenAI is on.
export function createConversationNotes(deps: ConversationNotesDeps) {
  async function owner(): Promise<string> {
    const found = chatPerson(await deps.currentUser());
    if (!found) throw new ConversationForbiddenError();
    return found.ownerId;
  }

  function chatterFor(
    actorId: string,
    answer: NonNullable<ConversationNotesDeps["answer"]>,
  ): Chatter {
    return {
      ask: (turns, signal) =>
        meteredAnswer((onUsage) => answer(turns, signal, onUsage), {
          signal,
          failureCode: "CHAT_FAILED",
          feature: FEATURE,
          record: (usage) =>
            deps.recordUsage({
              ownerId: actorId,
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
    // The newest conversations, without their messages. chatModel is ""
    // without OpenAI, so the chat page offers no way to talk.
    async list(): Promise<{
      chatModel: string;
      conversations: ConversationSummary[];
    }> {
      const ownerId = await owner();
      return {
        chatModel: deps.chatModel ?? "",
        conversations: await deps.store.list(ownerId, CONVERSATION_LIST_LIMIT),
      };
    },

    // null: not one of the owner's conversations.
    async get(id: string): Promise<Conversation | null> {
      const ownerId = await owner();
      if (!CONVERSATION_ID.test(id)) return null;
      return deps.store.get(ownerId, id);
    },

    // Saves the whole conversation the browser sent, title trimmed, under
    // the model name it sent. Another owner's id is a conflict.
    async save(input: SaveConversationInput): Promise<SaveConversationResult> {
      const ownerId = await owner();
      const conversation = checkConversation(input);
      if (!conversation) return "invalid";
      if (!deps.chatModel) return "unavailable";
      const saved = await deps.store.save(ownerId, conversation, deps.now());
      return saved ? "saved" : "conflict";
    },

    // false: the owner has no such conversation.
    async remove(id: string): Promise<boolean> {
      const ownerId = await owner();
      if (!CONVERSATION_ID.test(id)) return false;
      return deps.store.remove(ownerId, id);
    },

    // A way to chat, or why there is none. Checked in this order: signed
    // in, a member or admin, not the demo, OpenAI configured.
    async chatter(): Promise<
      { ok: true; asker: Chatter } | { ok: false; reason: AskRefusal }
    > {
      const user = await deps.currentUser();
      const refusal = askRefusal(user);
      const found = chatPerson(user);
      if (refusal || !found)
        return { ok: false, reason: refusal ?? "forbidden" };
      if (!deps.answer || !deps.chatModel)
        return { ok: false, reason: "unavailable" };
      return { ok: true, asker: chatterFor(found.actorId, deps.answer) };
    },
  };
}

export type ConversationNotes = ReturnType<typeof createConversationNotes>;
