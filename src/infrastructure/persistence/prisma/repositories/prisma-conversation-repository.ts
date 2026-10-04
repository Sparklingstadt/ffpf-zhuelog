import {
  conversationSchema,
  ConversationOwnershipError,
  type Conversation,
  type ConversationSummary,
} from "@ffpf-zhuelog/core/domain/chat/conversation";
import type {
  ConversationNoteRepository,
  DailyConversation,
} from "@ffpf-zhuelog/core/domain/chat/repositories/conversation-note-repository";
import type { ConversationRepository } from "@ffpf-zhuelog/core/domain/chat/repositories/conversation-repository";
import type { DateRange } from "@ffpf-zhuelog/core/domain/learning/value-objects/log-date";
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
  createdAt: { gte: range.start, lt: range.end },
});
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
          update: data,
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
      where: { ownerId },
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
    const row = await getPrismaClient().chatConversation.findUnique({
      where: { id_ownerId: { id, ownerId } },
    });
    return row ? map(row) : null;
  }
  async listCreatedAt(ownerId: string) {
    const rows = await getPrismaClient().chatConversation.findMany({
      where: { ownerId },
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
}
