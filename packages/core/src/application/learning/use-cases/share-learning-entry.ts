import type { LearningEntryRepository } from "../../../domain/learning/repositories/learning-entry-repository";

export class ShareLearningEntry {
  constructor(private readonly repository: LearningEntryRepository) {}

  execute(ownerId: string, id: string, shared: boolean) {
    return this.repository.setShared(ownerId, id, shared);
  }
}
