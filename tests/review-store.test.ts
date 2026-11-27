import assert from "node:assert/strict";
import { test } from "node:test";

import { nextFsrsCard, type FsrsCard } from "../src/domain/review/fsrs";
import { newId } from "../src/infrastructure/prisma/new-id";
import {
  REVIEW_ITEM_ID,
  enqueueReviewItemsSql,
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
    userId: "github:1",
    itemId: "cabcdefghijklmnopqrstuvwx",
    rating: 3,
    before,
    reviewedAt,
  });
  assert.deepEqual(row, {
    id: "0b6c3f2e-1d4a-4c8e-9f00-123456789abc",
    userId: "github:1",
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

test("enqueueReviewItemsSql brings a card forward in one statement", () => {
  const now = new Date("2026-11-16T09:00:00.000Z");
  const ids = ["cid000000000000000000001", "cid000000000000000000002"];
  let next = 0;
  const sql = enqueueReviewItemsSql(
    "github:1",
    [
      { language: "zh", kind: "preposition", targetId: "P001:学校" },
      { language: "zh", kind: "preposition", targetId: "P002:家" },
    ],
    now,
    () => ids[next++],
  );
  assert.ok(sql);
  const text = sql.sql.replace(/\s+/g, " ");
  assert.ok(
    text.includes(
      'INSERT INTO "ReviewItem" ("id", "userId", "language", "kind", "targetId", "due", "state", "createdAt", "updatedAt")',
    ),
    text,
  );
  assert.ok(
    text.includes(
      'ON CONFLICT ("userId", "language", "kind", "targetId") DO UPDATE SET "due" = EXCLUDED."due", "updatedAt" = EXCLUDED."updatedAt" WHERE "ReviewItem"."due" > EXCLUDED."due"',
    ),
    text,
  );
  assert.equal(text.match(/INSERT/g)?.length, 1);
  assert.doesNotMatch(text, /SELECT/);
  assert.doesNotMatch(text, /FOR UPDATE/);
  assert.deepEqual(sql.values, [
    ids[0],
    "github:1",
    "zh",
    "preposition",
    "P001:学校",
    now,
    0,
    now,
    now,
    ids[1],
    "github:1",
    "zh",
    "preposition",
    "P002:家",
    now,
    0,
    now,
    now,
  ]);

  assert.equal(enqueueReviewItemsSql("github:1", [], now), null);
});

test("enqueueReviewItemsSql stays within Postgres's bind limit for the largest round", () => {
  const now = new Date("2026-11-16T09:00:00.000Z");
  const targets = Array.from({ length: 50 }, (_, i) => ({
    language: "zh" as const,
    kind: "complement" as const,
    targetId: `result-${String(i).padStart(2, "0")}`,
  }));
  const sql = enqueueReviewItemsSql("github:1", targets, now);
  assert.ok(sql);
  assert.equal(sql.values.length, 50 * 9);
  assert.ok(sql.values.length <= 65_535);
  // The default ids are fresh review item ids.
  for (let i = 0; i < 50; i += 1) {
    assert.match(String(sql.values[i * 9]), REVIEW_ITEM_ID);
  }
});
