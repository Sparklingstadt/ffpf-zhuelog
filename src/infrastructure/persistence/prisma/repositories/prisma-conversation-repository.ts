import {
  conversationSchema,
  ConversationOwnershipError,
  type Conversation,
  type ConversationSummary,
} from "@ffpf-zhuelog/core/domain/chat/conversation";
import type {
  ConversationNoteRepository,
  DailyConversation,
  TrashedConversationNotes,
} from "@ffpf-zhuelog/core/domain/chat/repositories/conversation-note-repository";
import type { ConversationRepository } from "@ffpf-zhuelog/core/domain/chat/repositories/conversation-repository";
import type { DateRange } from "@ffpf-zhuelog/core/domain/calendar/value-objects/log-date";
import { getPrismaClient } from "../prisma-client";
import type { ChatConversation } from "@/generated/prisma/client";
function map(row: ChatConversation): Conversation {
  return conversationSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
const oldestFirst = [{ createdAt: "asc" as const }, { id: "asc" as const }];
const createdWithin = (ownerId: string, range: DateRange) => ({
  ownerId,
  deletedAt: null,
  createdAt: { gte: range.start, lt: range.end },
});
const inTrash = { deletedAt: { not: null } };
export class PrismaConversationRepository
  implements ConversationRepository, ConversationNoteRepository
{
  async save(ownerId: string, value: Conversation) {
    const data = {
      title: value.title,
      modelName: value.modelName,
      ended: value.ended,
      messages: value.messages,
    };
    try {
      return map(
        await getPrismaClient().chatConversation.upsert({
          where: { id_ownerId: { id: value.id, ownerId } },
          create: { id: value.id, ownerId, ...data },
          // Saving a conversation again takes it back out of the trash.
          update: { ...data, deletedAt: null },
        }),
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      )
        throw new ConversationOwnershipError();
      throw error;
    }
  }
  async list(ownerId: string): Promise<ConversationSummary[]> {
    const rows = await getPrismaClient().chatConversation.findMany({
      where: { ownerId, deletedAt: null },
      take: 50,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        modelName: true,
        ended: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
  async get(ownerId: string, id: string) {
    const row = await getPrismaClient().chatConversation.findFirst({
      where: { id, ownerId, deletedAt: null },
    });
    return row ? map(row) : null;
  }
  async listCreatedAt(ownerId: string) {
    const rows = await getPrismaClient().chatConversation.findMany({
      where: { ownerId, deletedAt: null },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => row.createdAt);
  }
  async listByDate(ownerId: string, range: DateRange) {
    const rows = await getPrismaClient().chatConversation.findMany({
      where: createdWithin(ownerId, range),
      orderBy: oldestFirst,
    });
    return rows.map((row) => {
      const { messages, ...summary } = map(row);
      return { ...summary, messageCount: messages.length };
    });
  }
  async getByDateAndNumber(
    ownerId: string,
    range: DateRange,
    noteNumber: number,
  ): Promise<DailyConversation | null> {
    const prisma = getPrismaClient();
    const where = createdWithin(ownerId, range);
    const total = await prisma.chatConversation.count({ where });
    if (
      !Number.isSafeInteger(noteNumber) ||
      noteNumber < 1 ||
      noteNumber > total
    )
      return null;
    const row = await prisma.chatConversation.findFirst({
      where,
      orderBy: oldestFirst,
      skip: noteNumber - 1,
    });
    return row ? { conversation: map(row), total } : null;
  }
  async trash(ownerId: string, id: string) {
    const { count } = await getPrismaClient().chatConversation.updateMany({
      where: { id, ownerId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count === 1;
  }
  async restore(ownerId: string, id: string) {
    const { count } = await getPrismaClient().chatConversation.updateMany({
      where: { id, ownerId, ...inTrash },
      data: { deletedAt: null },
    });
    return count === 1;
  }
  async purge(ownerId: string, id: string) {
    const { count } = await getPrismaClient().chatConversation.deleteMany({
      where: { id, ownerId, ...inTrash },
    });
    return count === 1;
  }
  async emptyTrash(ownerId: string) {
    const { count } = await getPrismaClient().chatConversation.deleteMany({
      where: { ownerId, ...inTrash },
    });
    return count;
  }
  async listTrashed(
    ownerId: string,
    limit: number,
  ): Promise<TrashedConversationNotes> {
    const prisma = getPrismaClient();
    const where = { ownerId, ...inTrash };
    const [rows, total] = await Promise.all([
      prisma.chatConversation.findMany({
        where,
        orderBy: [{ deletedAt: "desc" }, { id: "asc" }],
        take: limit,
      }),
      prisma.chatConversation.count({ where }),
    ]);
    return {
      conversations: rows.map((row) => {
        const { messages, ...summary } = map(row);
        return {
          ...summary,
          messageCount: messages.length,
          deletedAt: row.deletedAt!.toISOString(),
        };
      }),
      total,
    };
  }
}
