import type {
  DueReviews,
  ReviewItem,
  ReviewRating,
} from "@/domain/review/review-item";

import { goApiAuthed, type GoApiCall } from "./authed";

type ItemJson = Omit<ReviewItem, "due" | "lastReview" | "vocabulary"> & {
  due: string;
  lastReview: string | null;
  vocabulary?: { id: string; word: string; pinyin: string; meaning: string };
};

const toItem = (json: ItemJson): ReviewItem => ({
  id: json.id,
  language: json.language,
  kind: json.kind,
  targetId: json.targetId,
  due: new Date(json.due),
  state: json.state,
  reps: json.reps,
  lapses: json.lapses,
  lastReview: json.lastReview ? new Date(json.lastReview) : null,
  vocabulary: json.vocabulary
    ? {
        id: json.vocabulary.id,
        word: json.vocabulary.word,
        pinyin: json.vocabulary.pinyin,
        meaning: json.vocabulary.meaning,
      }
    : null,
});

// The review queue is always the signed-in user's own (the token's owner in
// Go, or the member an admin acts as).
export function createReviewGateway(call: GoApiCall = goApiAuthed) {
  return {
    // How many items are due now and the first `limit` of them, the longest
    // overdue first.
    async listDue(limit: number): Promise<DueReviews> {
      const json = await call<{
        count: number;
        streakDays: number;
        items: ItemJson[];
      }>(`/v1/reviews/due?limit=${encodeURIComponent(String(limit))}`, {
        method: "GET",
      });
      return {
        count: json.count,
        streakDays: json.streakDays,
        items: json.items.map(toItem),
      };
    },

    // Go applies the answer once per logId, so a retry is safe.
    async answer(answer: {
      itemId: string;
      logId: string;
      rating: ReviewRating;
    }): Promise<ReviewItem> {
      return toItem(
        await call<ItemJson>(
          `/v1/reviews/${encodeURIComponent(answer.itemId)}`,
          {
            method: "POST",
            body: { logId: answer.logId, rating: answer.rating },
          },
        ),
      );
    },
  };
}

export type ReviewGateway = ReturnType<typeof createReviewGateway>;
