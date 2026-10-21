import type { LearningEntryDraft } from "@/domain/learning/entities/learning-entry";
import type {
  LearningEntryRepository,
  SharedLearningEntry,
} from "@/domain/learning/repositories/learning-entry-repository";
import { getPrismaClient } from "@/infrastructure/persistence/prisma/prisma-client";
import { toLearningEntry } from "@/infrastructure/persistence/prisma/mappers/learning-entry-mapper";

const hintsByPosition = { orderBy: { position: "asc" as const } };

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
