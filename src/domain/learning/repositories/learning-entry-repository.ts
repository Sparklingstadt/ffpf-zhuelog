import type {
  LearningEntry,
  LearningEntryDraft,
} from "../../../domain/learning/entities/learning-entry";

export type SharedLearningEntry = LearningEntry & { ownerId: string };

export type TrashedLearningEntry = LearningEntry & { deletedAt: Date };

export type TrashedLearningEntries = {
  entries: TrashedLearningEntry[];
  total: number;
};

// Learning notes belong to the user who wrote them: every method is scoped to
// one owner id, including the counts. Notes in the trash (deletedAt set) are
// left out of everything but the trash methods.
// A note is shared while its sharedAt is set; the trash keeps sharedAt, but a
// trashed note is never listed as shared.
export interface LearningEntryRepository {
  importBatch(
    ownerId: string,
    fileName: string,
    entries: LearningEntryDraft[],
  ): Promise<number>;
  // Each returns false when the owner has no such note in the expected state:
  // trash only moves a note that is not in the trash yet, restore and purge
  // only touch one that is.
  trash(ownerId: string, id: string): Promise<boolean>;
  restore(ownerId: string, id: string): Promise<boolean>;
  purge(ownerId: string, id: string): Promise<boolean>;
  emptyTrash(ownerId: string): Promise<number>;
  listTrashed(ownerId: string, limit: number): Promise<TrashedLearningEntries>;
  // Sharing an already shared note keeps its sharedAt and still returns true;
  // false means the owner has no such note outside the trash.
  setShared(ownerId: string, id: string, shared: boolean): Promise<boolean>;
  // Notes the given owners share, newest first. Shared means sharedAt is set;
  // notes in the trash are left out.
  listSharedByOwners(
    ownerIds: string[],
    limit: number,
  ): Promise<SharedLearningEntry[]>;
}
