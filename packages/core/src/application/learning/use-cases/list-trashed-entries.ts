import type { LearningEntryRepository } from "../../../domain/learning/repositories/learning-entry-repository";

// The trash page shows this many notes; emptying the trash removes them all.
export const TRASH_LIST_LIMIT = 100;

export class ListTrashedEntries {
  constructor(private readonly repository: LearningEntryRepository) {}

  execute(ownerId: string, limit = TRASH_LIST_LIMIT) {
    return this.repository.listTrashed(ownerId, limit);
  }
}
