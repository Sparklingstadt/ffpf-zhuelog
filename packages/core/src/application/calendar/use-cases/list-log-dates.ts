import {
  getLogDateKey,
  getTokyoDateParts,
  type LogDate,
} from "../../../domain/calendar/value-objects/log-date";

export type LogDateSummary = {
  date: LogDate;
  count: number;
};

// Any notes browsed by JST date, such as learning and conversation notes.
export type CreatedAtSource = {
  listCreatedAt(ownerId: string): Promise<Date[]>;
};

export class ListLogDates {
  constructor(private readonly repository: CreatedAtSource) {}

  async execute(ownerId: string): Promise<LogDateSummary[]> {
    const timestamps = await this.repository.listCreatedAt(ownerId);
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
