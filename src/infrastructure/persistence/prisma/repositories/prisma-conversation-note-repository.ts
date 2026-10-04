import type {
  ConversationNoteDraft,
  ConversationNoteSummary,
} from "@ffpf-zhuelog/core/domain/conversation/entities/conversation-note";
import type {
  ConversationNoteRepository,
  DailyConversationNote,
} from "@ffpf-zhuelog/core/domain/conversation/repositories/conversation-note-repository";
import type { DateRange } from "@ffpf-zhuelog/core/domain/learning/value-objects/log-date";
import { getPrismaClient } from "@/infrastructure/persistence/prisma/prisma-client";

const oldestFirst = [{ createdAt: "asc" as const }, { id: "asc" as const }];
const summarySelect = {
  id: true,
  title: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { messages: true } },
};

type SummaryRecord = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  _count: { messages: number };
};

function toSummary(record: SummaryRecord): ConversationNoteSummary {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: record._count.messages,
  };
}

function messageRows(draft: ConversationNoteDraft) {
  return draft.messages.map((message, position) => ({
    role: message.role,
    content: message.text,
    position,
  }));
}

export class PrismaConversationNoteRepository implements ConversationNoteRepository {
  async create(draft: ConversationNoteDraft) {
    const record = await getPrismaClient().conversationNote.create({
      data: { title: draft.title, messages: { create: messageRows(draft) } },
      select: summarySelect,
    });
    return toSummary(record);
  }

  async update(id: string, draft: ConversationNoteDraft) {
    return getPrismaClient().$transaction(async (tx) => {
      const existing = await tx.conversationNote.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) return null;
      const record = await tx.conversationNote.update({
        where: { id },
        data: {
          title: draft.title,
          messages: { deleteMany: {}, create: messageRows(draft) },
        },
        select: summarySelect,
      });
      return toSummary(record);
    });
  }

  async listCreatedAt(): Promise<Date[]> {
    const records = await getPrismaClient().conversationNote.findMany({
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return records.map((record) => record.createdAt);
  }

  async listByDate(range: DateRange) {
    const records = await getPrismaClient().conversationNote.findMany({
      where: { createdAt: { gte: range.start, lt: range.end } },
      select: summarySelect,
      orderBy: oldestFirst,
    });
    return records.map(toSummary);
  }

  async getByDateAndNumber(
    range: DateRange,
    noteNumber: number,
  ): Promise<DailyConversationNote | null> {
    const prisma = getPrismaClient();
    const where = { createdAt: { gte: range.start, lt: range.end } };
    const total = await prisma.conversationNote.count({ where });
    if (
      !Number.isSafeInteger(noteNumber) ||
      noteNumber < 1 ||
      noteNumber > total
    )
      return null;
    const record = await prisma.conversationNote.findFirst({
      where,
      include: { messages: { orderBy: { position: "asc" } } },
      orderBy: oldestFirst,
      skip: noteNumber - 1,
    });
    if (!record) return null;

    return {
      note: {
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        messages: record.messages.map((message) => ({
          id: message.id,
          role: message.role === "user" ? "user" : "assistant",
          text: message.content,
          position: message.position,
        })),
      },
      total,
    };
  }
}
