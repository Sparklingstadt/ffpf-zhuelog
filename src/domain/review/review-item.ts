import type { LearningEntry } from "@/domain/learning/entities/learning-entry";
import type { VocabularyCard } from "@/domain/vocabulary/vocabulary-entry";

// An item of the signed-in user's spaced-repetition queue, as the Go API
// keeps it. kind says what targetId names ("preposition": "P001:学校",
// "complement": "result-01", "vocabulary": the word's id, with the word in
// vocabulary, "entry": a learning note's id, with the note in entry).
export type ReviewItem = {
  id: string;
  language: string;
  kind: string;
  targetId: string;
  due: Date;
  // 0 new, 1 learning, 2 review, 3 relearning.
  state: number;
  reps: number;
  lapses: number;
  lastReview: Date | null;
  vocabulary: VocabularyCard | null;
  entry: LearningEntry | null;
  // When each answer, もう一度 to 簡単, would bring the item back; null when
  // Go could not tell (only the due list says).
  nextDue: readonly [Date, Date, Date, Date] | null;
};

export type DueReviews = {
  // Every item due now, which may be more than items holds.
  count: number;
  // count by kind ("entry", "vocabulary", "preposition", "complement");
  // kinds with nothing due are absent.
  byKind: Readonly<Record<string, number>>;
  // Days in a row, Japan time, with at least one review, up to today or
  // yesterday.
  streakDays: number;
  // Whether there was a review on each of the last 7 days, Japan time,
  // oldest first; the last is today.
  recentDays: readonly boolean[];
  items: ReviewItem[];
};

// The four answers FSRS takes, worst to best.
export const REVIEW_RATINGS = [
  { rating: 1, label: "もう一度" },
  { rating: 2, label: "難しい" },
  { rating: 3, label: "できた" },
  { rating: 4, label: "簡単" },
] as const;

export type ReviewRating = (typeof REVIEW_RATINGS)[number]["rating"];

export function isReviewRating(value: unknown): value is ReviewRating {
  return REVIEW_RATINGS.some((r) => r.rating === value);
}
