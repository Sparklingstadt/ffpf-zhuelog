import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
} from "@/domain/chat/conversation";

import { goApiAuthed, type GoApiCall } from "./authed";
import { GoApiError } from "./client";

// Go has no chat routes (OPENAI_API_KEY is not set).
export class ChatUnavailableError extends Error {
  constructor() {
    super("The Go API has no chat");
    this.name = "ChatUnavailableError";
  }
}

type SummaryJson = Omit<ConversationSummary, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};
type ConversationJson = SummaryJson & { messages: ConversationMessage[] };

const toSummary = (json: SummaryJson): ConversationSummary => ({
  id: json.id,
  title: json.title,
  modelName: json.modelName,
  ended: json.ended,
  createdAt: new Date(json.createdAt),
  updatedAt: new Date(json.updatedAt),
});

// Conversations are always the signed-in user's own (the token's owner in
// Go), newest first.
export function createConversationGateway(call: GoApiCall = goApiAuthed) {
  const path = (id: string) => `/v1/conversations/${encodeURIComponent(id)}`;

  return {
    async list(): Promise<{
      chatModel: string;
      conversations: ConversationSummary[];
    }> {
      try {
        const json = await call<{
          chatModel: string;
          conversations: SummaryJson[];
        }>("/v1/conversations", { method: "GET" });
        return {
          chatModel: json.chatModel,
          conversations: json.conversations.map(toSummary),
        };
      } catch (error) {
        if (error instanceof GoApiError && error.status === 404)
          throw new ChatUnavailableError();
        throw error;
      }
    },

    async get(id: string): Promise<Conversation | null> {
      try {
        const json = await call<ConversationJson>(path(id), { method: "GET" });
        return { ...toSummary(json), messages: json.messages };
      } catch (error) {
        if (error instanceof GoApiError && error.status === 404) return null;
        throw error;
      }
    },

    // Go keeps the first createdAt and sets updatedAt itself.
    async save(conversation: Conversation): Promise<void> {
      await call<unknown>(path(conversation.id), {
        method: "PUT",
        body: {
          title: conversation.title,
          modelName: conversation.modelName,
          ended: conversation.ended,
          createdAt: conversation.createdAt.toISOString(),
          messages: conversation.messages,
        },
      });
    },

    async remove(id: string): Promise<void> {
      await call<unknown>(path(id), { method: "DELETE" });
    },
  };
}

export type ConversationGateway = ReturnType<typeof createConversationGateway>;
