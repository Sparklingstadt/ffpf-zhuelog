import type { LearningEntryDraft } from "@/domain/learning/entities/learning-entry";
import type {
  DailyLearningEntry,
  LearningEntryRepository,
  RecentLearningEntries,
} from "@/domain/learning/repositories/learning-entry-repository";
import type { DateRange } from "@/domain/learning/value-objects/log-date";
import { getPrismaClient } from "@/infrastructure/persistence/prisma/prisma-client";
import { toLearningEntry } from "@/infrastructure/persistence/prisma/mappers/learning-entry-mapper";

const hintsByPosition = { orderBy: { position: "asc" as const } };
const oldestFirst = [{ createdAt: "asc" as const }, { id: "asc" as const }];

export class PrismaLearningEntryRepository implements LearningEntryRepository {
  async importBatch(fileName: string, entries: LearningEntryDraft[]): Promise<number> {
    const prisma = getPrismaClient();

    await prisma.$transaction(
      async (tx) => {
        const batch = await tx.importBatch.create({
          data: { fileName, rowCount: entries.length },
        });

        for (const entry of entries) {
          await tx.learningEntry.create({
            data: {
              batchId: batch.id,
              originalText: entry.originalText,
              correctedText: entry.correctedText,
              pinyin: entry.pinyin,
              hints: {
                create: entry.hints.map((content, position) => ({ content, position })),
              },
            },
          });
        }
      },
      { timeout: 30_000 },
    );

    return entries.length;
  }

  async listRecent(limit: number): Promise<RecentLearningEntries> {
    const prisma = getPrismaClient();
    const [records, total] = await Promise.all([
      prisma.learningEntry.findMany({
        include: { hints: hintsByPosition },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.learningEntry.count(),
    ]);

    return { entries: records.map(toLearningEntry), total };
  }

  async listCreatedAt(): Promise<Date[]> {
    const records = await getPrismaClient().learningEntry.findMany({
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return records.map((record) => record.createdAt);
  }

  async listByDate(range: DateRange) {
    const records = await getPrismaClient().learningEntry.findMany({
      where: { createdAt: { gte: range.start, lt: range.end } },
      include: { hints: hintsByPosition },
      orderBy: oldestFirst,
    });
    return records.map(toLearningEntry);
  }

  async getByDateAndNumber(
    range: DateRange,
    entryNumber: number,
  ): Promise<DailyLearningEntry | null> {
    const prisma = getPrismaClient();
    const where = { createdAt: { gte: range.start, lt: range.end } };
    const [record, total] = await Promise.all([
      prisma.learningEntry.findFirst({
        where,
        include: { hints: hintsByPosition },
        orderBy: oldestFirst,
        skip: entryNumber - 1,
      }),
      prisma.learningEntry.count({ where }),
    ]);

    if (!record || entryNumber > total) return null;
    return { entry: toLearningEntry(record), total };
  }
}
