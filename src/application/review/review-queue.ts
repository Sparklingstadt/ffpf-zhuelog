import {
  isMemberRole,
  type AuthenticatedUser,
} from "../../domain/identity/entities/authenticated-user";
import type { LearningEntry } from "../../domain/learning/entities/learning-entry";
import { nextFsrsDues, type FsrsCard } from "../../domain/review/fsrs";
import {
  japanDate,
  japanMidnightBefore,
  recentReviewDays,
  REVIEW_HISTORY_DAYS,
  reviewStreak,
} from "../../domain/review/review-days";
import {
  REVIEW_ITEM_ID,
  REVIEW_LOG_ID,
  type DueReviews,
  type DueSummary,
  type ReviewItem,
  type ReviewRating,
} from "../../domain/review/review-item";
import type { VocabularyCard } from "../../domain/vocabulary/vocabulary-entry";

// The signed-in user has no review queue: signed out or a guest.
export class ReviewForbiddenError extends Error {
  override name = "ReviewForbiddenError";
}

// The most items one due list may hold.
const MAX_DUE_LIMIT = 100;

// An item as the store reads it: the FSRS card and, for a word or a note,
// the target when it still exists.
type StoredItem = {
  id: string;
  language: string;
  kind: string;
  targetId: string;
  card: FsrsCard;
  vocabulary: VocabularyCard | null;
  entry: LearningEntry | null;
};

export type ReviewQueueDeps = {
  currentUser: () => Promise<AuthenticatedUser | null>;
  // Every call names the owner whose queue it reads or writes.
  store: {
    countDue(ownerId: string, now: Date): Promise<number>;
    countDueByKind(ownerId: string, now: Date): Promise<Record<string, number>>;
    listDue(ownerId: string, now: Date, limit: number): Promise<StoredItem[]>;
    // Japan dates ("YYYY-MM-DD") with an answer at or after `since`.
    reviewedDates(ownerId: string, since: Date): Promise<string[]>;
    // false when the item is not the owner's or logId is another item's.
    answer(
      ownerId: string,
      itemId: string,
      logId: string,
      rating: number,
      now: Date,
    ): Promise<boolean>;
    entryIdsInReview(ownerId: string): Promise<Set<string>>;
  };
  now: () => Date;
};

// Today's reviews, always the signed-in user's own queue (the member an
// admin impersonates; the demo has one too), never an owner from a form.
export function createReviewQueue(deps: ReviewQueueDeps) {
  async function owner(): Promise<string> {
    const user = await deps.currentUser();
    if (!user || !isMemberRole(user.role)) throw new ReviewForbiddenError();
    return user.userId;
  }

  // The counts by kind and the review days, read together.
  async function readSummary(ownerId: string, now: Date): Promise<DueSummary> {
    const today = japanDate(now);
    const [byKind, reviewed] = await Promise.all([
      deps.store.countDueByKind(ownerId, now),
      deps.store.reviewedDates(
        ownerId,
        japanMidnightBefore(today, REVIEW_HISTORY_DAYS),
      ),
    ]);
    return {
      count: Object.values(byKind).reduce((sum, n) => sum + n, 0),
      byKind,
      streakDays: reviewStreak(today, reviewed),
      recentDays: recentReviewDays(today, reviewed),
    };
  }

  return {
    // How many items are due now and the first `limit` (1..100) of them,
    // the longest overdue first, with the streak. One `now` is used for
    // every read and every item's next dues. The three reads do not need
    // each other's answer, so they are asked for together: the database may
    // be far from the server, and each wait is a round trip.
    async listDue(limit: number): Promise<DueReviews> {
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DUE_LIMIT)
        throw new RangeError("the due list limit must be 1 to 100");
      const ownerId = await owner();
      const now = deps.now();
      const [summary, stored] = await Promise.all([
        readSummary(ownerId, now),
        deps.store.listDue(ownerId, now, limit),
      ]);
      return {
        ...summary,
        items: stored.map((item) => toReviewItem(item, now)),
      };
    },

    // listDue's numbers without the items, for the home's card: it reads no
    // item, note or word.
    async dueSummary(): Promise<DueSummary> {
      return readSummary(await owner(), deps.now());
    },

    // Only how many items are due now, for the badge in the header.
    async countDue(): Promise<number> {
      return deps.store.countDue(await owner(), deps.now());
    },

    // The ids of the user's live notes in their review queue.
    async entriesInReview(): Promise<Set<string>> {
      return deps.store.entryIdsInReview(await owner());
    },

    // Applied once per logId, so a retry is safe. false when the item is
    // not the user's (or not an item id at all), logId is not a UUID or it is another item's.
    async answer(answer: {
      itemId: string;
      logId: string;
      rating: ReviewRating;
    }): Promise<boolean> {
      const ownerId = await owner();
      if (!REVIEW_ITEM_ID.test(answer.itemId)) return false;
      if (!REVIEW_LOG_ID.test(answer.logId)) return false;
      return deps.store.answer(
        ownerId,
        answer.itemId,
        answer.logId,
        answer.rating,
        deps.now(),
      );
    },
  };
}

function toReviewItem(item: StoredItem, now: Date): ReviewItem {
  return {
    id: item.id,
    language: item.language,
    kind: item.kind,
    targetId: item.targetId,
    due: item.card.due,
    state: item.card.state,
    reps: item.card.reps,
    lapses: item.card.lapses,
    lastReview: item.card.lastReview,
    vocabulary: item.vocabulary,
    entry: item.entry,
    nextDue: nextFsrsDues(item.card, now),
  };
}

export type ReviewQueue = ReturnType<typeof createReviewQueue>;
