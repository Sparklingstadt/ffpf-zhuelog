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

// Learning notes belong to the user who wrote them: every method is scoped to
// one owner id, including the per-day numbering and the counts.
export interface LearningEntryRepository {
  importBatch(
    ownerId: string,
    fileName: string,
    entries: LearningEntryDraft[],
  ): Promise<number>;
  listRecent(ownerId: string, limit: number): Promise<RecentLearningEntries>;
  listCreatedAt(ownerId: string): Promise<Date[]>;
  listByDate(ownerId: string, range: DateRange): Promise<LearningEntry[]>;
  getByDateAndNumber(
    ownerId: string,
    range: DateRange,
    entryNumber: number,
  ): Promise<DailyLearningEntry | null>;
}
