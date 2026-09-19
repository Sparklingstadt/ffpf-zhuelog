import type { LogDate } from "@/domain/learning/value-objects/log-date";
import { getLogDateKey, getTokyoDateParts } from "@/domain/learning/value-objects/log-date";
import type { LearningEntryRepository } from "@/domain/learning/repositories/learning-entry-repository";

export type LogDateSummary = {
  date: LogDate;
  count: number;
};

export class ListLogDates {
  constructor(private readonly repository: LearningEntryRepository) {}

  async execute(): Promise<LogDateSummary[]> {
    const timestamps = await this.repository.listCreatedAt();
    const groups = new Map<string, LogDateSummary>();

    for (const timestamp of timestamps) {
      const key = getLogDateKey(timestamp);
      const group = groups.get(key);
      if (group) group.count += 1;
      else groups.set(key, { date: getTokyoDateParts(timestamp), count: 1 });
    }

    return [...groups.values()];
  }
}
