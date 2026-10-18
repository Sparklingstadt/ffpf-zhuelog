import type { LearningEntryRepository } from "../../../domain/learning/repositories/learning-entry-repository";

export class RestoreLearningEntry {
  constructor(private readonly repository: LearningEntryRepository) {}

  execute(ownerId: string, id: string) {
    return this.repository.restore(ownerId, id);
  }
}
