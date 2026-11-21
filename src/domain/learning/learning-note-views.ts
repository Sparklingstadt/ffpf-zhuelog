import type { LogDate } from "../calendar/value-objects/log-date";
import type { LearningEntry } from "./entities/learning-entry";

// The newest notes (or those a search matches) and how many match in all.
export type RecentLearningEntries = { entries: LearningEntry[]; total: number };

// A Japan date with notes, and how many live notes it has.
export type LogDateSummary = { date: LogDate; count: number };

// One note of a Japan date and how many live notes that date has.
export type DailyLearningEntry = { entry: LearningEntry; total: number };

export type TrashedLearningEntry = LearningEntry & { deletedAt: Date };

export type TrashedLearningEntries = {
  entries: TrashedLearningEntry[];
  total: number;
};
