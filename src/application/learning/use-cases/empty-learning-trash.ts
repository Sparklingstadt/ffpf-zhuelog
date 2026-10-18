import type { LearningEntryRepository } from "../../../domain/learning/repositories/learning-entry-repository";

export class EmptyLearningTrash {
  constructor(private readonly repository: LearningEntryRepository) {}

  execute(ownerId: string) {
    return this.repository.emptyTrash(ownerId);
  }
}
