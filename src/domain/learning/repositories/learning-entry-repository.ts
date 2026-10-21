import type {
  LearningEntry,
  LearningEntryDraft,
} from "../../../domain/learning/entities/learning-entry";

export type SharedLearningEntry = LearningEntry & { ownerId: string };

// Learning notes belong to the user who wrote them.
export interface LearningEntryRepository {
  importBatch(
    ownerId: string,
    fileName: string,
    entries: LearningEntryDraft[],
  ): Promise<number>;
  // Notes the given owners share, newest first. Shared means sharedAt is set;
  // notes in the trash are left out.
  listSharedByOwners(
    ownerIds: string[],
    limit: number,
  ): Promise<SharedLearningEntry[]>;
}
