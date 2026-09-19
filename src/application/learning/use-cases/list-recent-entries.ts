import type { LearningEntryRepository } from "@/domain/learning/repositories/learning-entry-repository";

export class ListRecentEntries {
  constructor(private readonly repository: LearningEntryRepository) {}

  execute(limit = 100) {
    return this.repository.listRecent(limit);
  }
}
