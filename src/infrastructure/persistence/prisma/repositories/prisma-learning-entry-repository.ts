import type { LearningEntryDraft } from "@/domain/learning/entities/learning-entry";
import type {
  LearningEntryRepository,
  SharedLearningEntry,
  TrashedLearningEntries,
} from "@/domain/learning/repositories/learning-entry-repository";
import { getPrismaClient } from "@/infrastructure/persistence/prisma/prisma-client";
import { toLearningEntry } from "@/infrastructure/persistence/prisma/mappers/learning-entry-mapper";

const hintsByPosition = { orderBy: { position: "asc" as const } };
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
