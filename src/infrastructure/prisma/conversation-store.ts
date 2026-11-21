import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import {
  CONVERSATION_ID,
  type CheckedConversation,
  type Conversation,
  type ConversationMessage,
  type ConversationSummary,
} from "../../domain/chat/conversation";

// Pure: the one statement that saves a conversation. A new id inserts the
// row with the browser's createdAt; an existing id takes the title, model
// name, ended flag and messages and keeps its first createdAt (createdAt is
// not in the SET list). The WHERE makes another owner's id change nothing,
// so the statement affects 1 row when saved and 0 on such a conflict.
//
// Prisma's upsert cannot put a WHERE on its update (it would overwrite the
// other owner's row, or need a read first that races), so this is raw SQL,
// with bound parameters only. It is the statement of the retired Go API's
// store/conversations.go PutConversation (lines 84-106).
export function saveConversationSql(
  ownerId: string,
  conversation: CheckedConversation,
  now: Date,
): Prisma.Sql {
  // Only what the domain defines is stored, whatever else the object holds.
  const messages = JSON.stringify(
    conversation.messages.map(({ id, role, text }) => ({ id, role, text })),
  );
  return Prisma.sql`
    INSERT INTO "ChatConversation"
      ("id", "ownerId", "title", "modelName", "ended", "messages", "createdAt", "updatedAt")
    VALUES (${conversation.id}, ${ownerId}, ${conversation.title}, ${conversation.modelName},
      ${conversation.ended}, ${messages}::jsonb, ${conversation.createdAt}, ${now})
    ON CONFLICT ("id") DO UPDATE SET
      "title" = EXCLUDED."title",
      "modelName" = EXCLUDED."modelName",
      "ended" = EXCLUDED."ended",
      "messages" = EXCLUDED."messages",
      "updatedAt" = EXCLUDED."updatedAt"
    WHERE "ChatConversation"."ownerId" = EXCLUDED."ownerId"`;
}

// Pure: the messages column as the domain's messages. Throws when a row
// holds anything else (a row only this code or Go writes should not).
export function readConversationMessages(json: unknown): ConversationMessage[] {
  if (!Array.isArray(json))
    throw new Error("conversation messages: not a list");
  return json.map((item: unknown) => {
    if (typeof item !== "object" || item === null) {
      throw new Error("conversation messages: not an object");
    }
    const { id, role, text } = item as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      (role !== "user" && role !== "assistant") ||
      typeof text !== "string"
    ) {
      throw new Error("conversation messages: unexpected shape");
    }
    return { id, role, text };
  });
}

const SUMMARY_SELECT = {
  id: true,
  title: true,
  modelName: true,
  ended: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Newest first; conversations created in the same millisecond by the larger
// id.
const NEWEST_FIRST = [
  { createdAt: "desc" },
  { id: "desc" },
] as const satisfies {
  createdAt?: "desc";
  id?: "desc";
}[];

// Reads and writes the owner's saved conversations the way the retired Go API's
// store/conversations.go did. Every query names the owner; `now` comes from
// the caller, read once per request.
export function createConversationStore(db: () => PrismaClient) {
  return {
    // Without the messages.
    async list(ownerId: string, limit: number): Promise<ConversationSummary[]> {
      return db().chatConversation.findMany({
        where: { ownerId },
        orderBy: NEWEST_FIRST,
        take: limit,
        select: SUMMARY_SELECT,
      });
    },

    // null: not the owner's conversation (or not a conversation id at all).
    async get(ownerId: string, id: string): Promise<Conversation | null> {
      if (!CONVERSATION_ID.test(id)) return null;
      const row = await db().chatConversation.findUnique({
        where: { id_ownerId: { id, ownerId } },
        select: { ...SUMMARY_SELECT, messages: true },
      });
      if (!row) return null;
      const { messages, ...summary } = row;
      return { ...summary, messages: readConversationMessages(messages) };
    },

    // true: saved (new, or the owner's own updated). false: the id is
    // another owner's, and nothing was written. See saveConversationSql.
    async save(
      ownerId: string,
      conversation: CheckedConversation,
      now: Date,
    ): Promise<boolean> {
      const affected = await db().$executeRaw(
        saveConversationSql(ownerId, conversation, now),
      );
      return affected === 1;
    },

    // false: the owner has no such conversation.
    async remove(ownerId: string, id: string): Promise<boolean> {
      const { count } = await db().chatConversation.deleteMany({
        where: { id, ownerId },
      });
      return count > 0;
    },
  };
}

export type ConversationStore = ReturnType<typeof createConversationStore>;
