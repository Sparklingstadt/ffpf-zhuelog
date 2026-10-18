import type { LearningEntryRepository } from "../../../domain/learning/repositories/learning-entry-repository";
import {
  getTokyoDateRange,
  type LogDate,
} from "../../../domain/calendar/value-objects/log-date";

export class GetDailyEntry {
  constructor(private readonly repository: LearningEntryRepository) {}

  execute(ownerId: string, date: LogDate, entryNumber: number) {
    return this.repository.getByDateAndNumber(
      ownerId,
      getTokyoDateRange(date),
      entryNumber,
    );
  }
}
