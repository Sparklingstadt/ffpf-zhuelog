import type { LearningEntryRepository } from "../../../domain/learning/repositories/learning-entry-repository";

export class ListRecentEntries {
  constructor(private readonly repository: LearningEntryRepository) {}

  execute(ownerId: string, limit = 100) {
    return this.repository.listRecent(ownerId, limit);
  }
}
