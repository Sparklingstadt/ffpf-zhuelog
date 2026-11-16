import assert from "node:assert/strict";
import { test } from "node:test";

import { nextFsrsCard, type FsrsCard } from "../src/domain/review/fsrs";
import { newId } from "../src/infrastructure/prisma/new-id";
import {
  REVIEW_ITEM_ID,
  reviewLogRow,
} from "../src/infrastructure/prisma/review-store";

test("reviewLogRow keeps the card as it stood before the answer", () => {
  const before: FsrsCard = {
    due: new Date("2026-10-20T00:00:00.000Z"),
    stability: 2.3065,
    difficulty: 4.5,
    scheduledDays: 3,
    reps: 2,
    lapses: 0,
    state: 2,
    remainingSteps: 0,
    lastReview: new Date("2026-10-17T00:00:00.000Z"),
  };
  const reviewedAt = new Date("2026-10-21T09:30:00.123Z");
  // The answer moves the card on; the log must not follow it.
  const after = nextFsrsCard(before, 3, reviewedAt);
  assert.notEqual(after.due.getTime(), before.due.getTime());

  const row = reviewLogRow({
    logId: "0b6c3f2e-1d4a-4c8e-9f00-123456789abc",
    ownerId: "github:1",
    itemId: "cabcdefghijklmnopqrstuvwx",
    rating: 3,
    before,
    reviewedAt,
  });
  assert.deepEqual(row, {
    id: "0b6c3f2e-1d4a-4c8e-9f00-123456789abc",
    ownerId: "github:1",
    itemId: "cabcdefghijklmnopqrstuvwx",
    rating: 3,
    state: 2,
    due: new Date("2026-10-20T00:00:00.000Z"),
    stability: 2.3065,
    difficulty: 4.5,
    scheduledDays: 3,
    reviewedAt: new Date("2026-10-21T09:30:00.123Z"),
  });
});

test("REVIEW_ITEM_ID", () => {
  for (let i = 0; i < 20; i += 1) assert.match(newId(), REVIEW_ITEM_ID);
  assert.doesNotMatch("not-an-id", REVIEW_ITEM_ID);
  assert.doesNotMatch("cABCDEFGHIJKLMNOPQRSTUVWX", REVIEW_ITEM_ID);
  // 26 characters: one too many.
  assert.doesNotMatch("cabcdefghijklmnopqrstuvwxy", REVIEW_ITEM_ID);
  assert.doesNotMatch("", REVIEW_ITEM_ID);
});
