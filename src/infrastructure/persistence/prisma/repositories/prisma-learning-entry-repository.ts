import type { LearningEntryDraft } from "@ffpf-zhuelog/core/domain/learning/entities/learning-entry";
import type {
  DailyLearningEntry,
  LearningEntryRepository,
  RecentLearningEntries,
  SharedLearningEntry,
  TrashedLearningEntries,
} from "@ffpf-zhuelog/core/domain/learning/repositories/learning-entry-repository";
import type { DateRange } from "@ffpf-zhuelog/core/domain/calendar/value-objects/log-date";
import { getPrismaClient } from "@/infrastructure/persistence/prisma/prisma-client";
import { toLearningEntry } from "@/infrastructure/persistence/prisma/mappers/learning-entry-mapper";

const hintsByPosition = { orderBy: { position: "asc" as const } };
const oldestFirst = [{ createdAt: "asc" as const }, { id: "asc" as const }];
const inTrash = { deletedAt: { not: null } };

export class PrismaLearningEntryRepository implements LearningEntryRepository {
  async importBatch(
    ownerId: string,
    fileName: string,
    entries: LearningEntryDraft[],
  ): Promise<number> {
    const prisma = getPrismaClient();

    await prisma.$transaction(
      async (tx) => {
        const batch = await tx.importBatch.create({
          data: { fileName, rowCount: entries.length },
        });

        for (const entry of entries) {
          await tx.learningEntry.create({
            data: {
              ownerId,
              batchId: batch.id,
              kind: entry.kind ?? "correction",
              originalText: entry.originalText,
              correctedText: entry.correctedText,
              pinyin: entry.pinyin,
              hints: {
                create: entry.hints.map((content, position) => ({
                  content,
                  position,
                })),
              },
            },
          });
        }
      },
      { timeout: 30_000 },
    );

    return entries.length;
  }

  async listRecent(
    ownerId: string,
    limit: number,
  ): Promise<RecentLearningEntries> {
    const prisma = getPrismaClient();
    const [records, total] = await Promise.all([
      prisma.learningEntry.findMany({
        where: { ownerId, deletedAt: null },
        include: { hints: hintsByPosition },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.learningEntry.count({ where: { ownerId, deletedAt: null } }),
    ]);

    return { entries: records.map(toLearningEntry), total };
  }

  async listCreatedAt(ownerId: string): Promise<Date[]> {
    const records = await getPrismaClient().learningEntry.findMany({
      where: { ownerId, deletedAt: null },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return records.map((record) => record.createdAt);
  }

  async listByDate(ownerId: string, range: DateRange) {
    const records = await getPrismaClient().learningEntry.findMany({
      where: {
        ownerId,
        deletedAt: null,
        createdAt: { gte: range.start, lt: range.end },
      },
      include: { hints: hintsByPosition },
      orderBy: oldestFirst,
    });
    return records.map(toLearningEntry);
  }

  async getByDateAndNumber(
    ownerId: string,
    range: DateRange,
    entryNumber: number,
  ): Promise<DailyLearningEntry | null> {
    const prisma = getPrismaClient();
    const where = {
      ownerId,
      deletedAt: null,
      createdAt: { gte: range.start, lt: range.end },
    };
    const total = await prisma.learningEntry.count({ where });
    if (
      !Number.isSafeInteger(entryNumber) ||
      entryNumber < 1 ||
      entryNumber > total
    )
      return null;
    const record = await prisma.learningEntry.findFirst({
      where,
      include: { hints: hintsByPosition },
      orderBy: oldestFirst,
      skip: entryNumber - 1,
    });

    if (!record || entryNumber > total) return null;
    return { entry: toLearningEntry(record), total };
  }

  async trash(ownerId: string, id: string) {
    const { count } = await getPrismaClient().learningEntry.updateMany({
      where: { id, ownerId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count === 1;
  }

  async restore(ownerId: string, id: string) {
    const { count } = await getPrismaClient().learningEntry.updateMany({
      where: { id, ownerId, ...inTrash },
      data: { deletedAt: null },
    });
    return count === 1;
  }

  async purge(ownerId: string, id: string) {
    const { count } = await getPrismaClient().learningEntry.deleteMany({
      where: { id, ownerId, ...inTrash },
    });
    return count === 1;
  }

  async emptyTrash(ownerId: string) {
    const { count } = await getPrismaClient().learningEntry.deleteMany({
      where: { ownerId, ...inTrash },
    });
    return count;
  }

  async listTrashed(
    ownerId: string,
    limit: number,
  ): Promise<TrashedLearningEntries> {
    const prisma = getPrismaClient();
    const where = { ownerId, ...inTrash };
    const [records, total] = await Promise.all([
      prisma.learningEntry.findMany({
        where,
        include: { hints: hintsByPosition },
        orderBy: [{ deletedAt: "desc" }, { id: "asc" }],
        take: limit,
      }),
      prisma.learningEntry.count({ where }),
    ]);
    return {
      entries: records.map((record) => ({
        ...toLearningEntry(record),
        deletedAt: record.deletedAt!,
      })),
      total,
    };
  }

  async setShared(ownerId: string, id: string, shared: boolean) {
    const prisma = getPrismaClient();
    const owned = { id, ownerId, deletedAt: null };
    if (!shared) {
      const { count } = await prisma.learningEntry.updateMany({
        where: owned,
        data: { sharedAt: null },
      });
      return count === 1;
    }
    // Only a note that is not shared yet gets a new sharedAt, so sharing twice
    // keeps the first time.
    const { count } = await prisma.learningEntry.updateMany({
      where: { ...owned, sharedAt: null },
      data: { sharedAt: new Date() },
    });
    if (count === 1) return true;
    return (await prisma.learningEntry.count({ where: owned })) === 1;
  }

  async listSharedByOwners(
    ownerIds: string[],
    limit: number,
  ): Promise<SharedLearningEntry[]> {
    if (ownerIds.length === 0) return [];
    const records = await getPrismaClient().learningEntry.findMany({
      where: {
        ownerId: { in: ownerIds },
        sharedAt: { not: null },
        deletedAt: null,
      },
      include: { hints: hintsByPosition },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
    });
    return records.map((record) => ({
      ...toLearningEntry(record),
      ownerId: record.ownerId,
    }));
  }
}
