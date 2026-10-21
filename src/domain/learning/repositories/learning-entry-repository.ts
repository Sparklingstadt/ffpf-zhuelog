import type { LearningEntry } from "../../../domain/learning/entities/learning-entry";

export type SharedLearningEntry = LearningEntry & { ownerId: string };

// Learning notes belong to the user who wrote them.
export interface LearningEntryRepository {
  // Notes the given owners share, newest first. Shared means sharedAt is set;
  // notes in the trash are left out.
  listSharedByOwners(
    ownerIds: string[],
    limit: number,
  ): Promise<SharedLearningEntry[]>;
}
