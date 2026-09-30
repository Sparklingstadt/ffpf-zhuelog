import {
  conversationSchema,
  ConversationOwnershipError,
  type Conversation,
  type ConversationSummary,
} from "@ffpf-zhuelog/core/domain/chat/conversation";
import type { ConversationRepository } from "@ffpf-zhuelog/core/domain/chat/repositories/conversation-repository";
import { getPrismaClient } from "../prisma-client";
import type { ChatConversation } from "@/generated/prisma/client";
function map(row: ChatConversation): Conversation {
  return conversationSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
export class PrismaConversationRepository implements ConversationRepository {
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
}
