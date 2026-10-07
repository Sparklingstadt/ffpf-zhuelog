import type { LearningEntryRepository } from "../../../domain/learning/repositories/learning-entry-repository";

export class TrashLearningEntry {
  constructor(private readonly repository: LearningEntryRepository) {}

  execute(ownerId: string, id: string) {
    return this.repository.trash(ownerId, id);
  }
}
