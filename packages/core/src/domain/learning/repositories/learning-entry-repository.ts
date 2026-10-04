import type {
  LearningEntry,
  LearningEntryDraft,
} from "../../../domain/learning/entities/learning-entry";
import type { DateRange } from "../../../domain/calendar/value-objects/log-date";

export type RecentLearningEntries = {
  entries: LearningEntry[];
  total: number;
};

export type DailyLearningEntry = {
  entry: LearningEntry;
  total: number;
};

// Learning notes are shared: the admin writes them and guests may read them,
// so unlike conversations they have no owner.
export interface LearningEntryRepository {
  importBatch(fileName: string, entries: LearningEntryDraft[]): Promise<number>;
  listRecent(limit: number): Promise<RecentLearningEntries>;
  listCreatedAt(): Promise<Date[]>;
  listByDate(range: DateRange): Promise<LearningEntry[]>;
  getByDateAndNumber(
    range: DateRange,
    entryNumber: number,
  ): Promise<DailyLearningEntry | null>;
}
