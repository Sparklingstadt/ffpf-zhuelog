// An item of the signed-in user's spaced-repetition queue, as the Go API
// keeps it. kind says what targetId names ("preposition": "P001:学校",
// "complement": "result-01").
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
};

export type DueReviews = {
  // Every item due now, which may be more than items holds.
  count: number;
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
