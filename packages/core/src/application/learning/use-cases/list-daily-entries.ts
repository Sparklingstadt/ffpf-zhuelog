import type { LearningEntryRepository } from "../../../domain/learning/repositories/learning-entry-repository";
import {
  getTokyoDateRange,
  type LogDate,
} from "../../../domain/calendar/value-objects/log-date";

export class ListDailyEntries {
  constructor(private readonly repository: LearningEntryRepository) {}

  execute(date: LogDate) {
    return this.repository.listByDate(getTokyoDateRange(date));
  }
}
