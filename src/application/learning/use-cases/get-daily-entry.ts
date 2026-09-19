import type { LearningEntryRepository } from "@/domain/learning/repositories/learning-entry-repository";
import { getTokyoDateRange, type LogDate } from "@/domain/learning/value-objects/log-date";

export class GetDailyEntry {
  constructor(private readonly repository: LearningEntryRepository) {}

  execute(date: LogDate, entryNumber: number) {
    return this.repository.getByDateAndNumber(getTokyoDateRange(date), entryNumber);
  }
}
