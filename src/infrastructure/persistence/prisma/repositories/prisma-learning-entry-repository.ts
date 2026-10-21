import type {
  LearningEntryRepository,
  SharedLearningEntry,
} from "@/domain/learning/repositories/learning-entry-repository";
import { getPrismaClient } from "@/infrastructure/persistence/prisma/prisma-client";
import { toLearningEntry } from "@/infrastructure/persistence/prisma/mappers/learning-entry-mapper";

const hintsByPosition = { orderBy: { position: "asc" as const } };

export class PrismaLearningEntryRepository implements LearningEntryRepository {
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
