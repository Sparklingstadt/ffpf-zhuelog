import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createReviewQueue,
  ReviewForbiddenError,
  type ReviewQueueDeps,
} from "../src/application/review/review-queue";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import { nextFsrsDues, type FsrsCard } from "../src/domain/review/fsrs";
import type { StoredReviewItem } from "../src/infrastructure/prisma/review-store";

const member: AuthenticatedUser = {
  githubLogin: "taro",
  githubId: "password:abc",
  role: "member",
  accountId: "abc",
};
const actingAdmin: AuthenticatedUser = {
  githubLogin: "octocat",
  githubId: "password:abc",
  role: "admin",
  actingAs: { ownerId: "password:abc", loginId: "taro", displayName: "太郎" },
  actorId: "10001",
};
const demo: AuthenticatedUser = {
  githubLogin: "demo",
  githubId: "demo:1",
  role: "member",
  demo: true,
};
const guest: AuthenticatedUser = { githubLogin: "g", role: "guest" };
const revoked: AuthenticatedUser = { ...member, role: "revoked" };
const noGithubId: AuthenticatedUser = { githubLogin: "x", role: "member" };

// 2026-11-16 12:00 JST.
const now = new Date("2026-11-16T03:00:00.000Z");
const itemId = "cabcdefghijklmnopqrstuvwx";
const logId = "0b7e3f5a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

const newCard: FsrsCard = {
  due: now,
  stability: 0,
  difficulty: 0,
  scheduledDays: 0,
  reps: 0,
  lapses: 0,
  state: 0,
  remainingSteps: 0,
  lastReview: null,
};
// FSRS refuses a review card without stability.
const brokenCard: FsrsCard = {
  ...newCard,
  state: 2,
  stability: 0,
  difficulty: 5,
  lastReview: new Date("2026-11-10T03:00:00.000Z"),
};

const stored = (id: string, card: FsrsCard): StoredReviewItem => ({
  id,
  language: "zh",
  kind: "preposition",
  targetId: "P001:学校",
  card,
  vocabulary: null,
  entry: null,
});

// Records every store call with its arguments.
function setup(user: AuthenticatedUser | null) {
  const calls: unknown[][] = [];
  const record =
    <R>(name: string, result: R) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return result;
    };
  const deps: ReviewQueueDeps = {
    currentUser: async () => user,
    store: {
      countDue: record("countDue", 3),
      countDueByKind: record("countDueByKind", { preposition: 2, entry: 1 }),
      listDue: record("listDue", [
        stored("c000000000000000000000001", newCard),
        stored("c000000000000000000000002", brokenCard),
      ]),
      reviewedDates: record("reviewedDates", [
        "2026-11-16",
        "2026-11-15",
        "2026-11-13",
      ]),
      answer: record("answer", true),
      entryIdsInReview: record("entryIdsInReview", new Set(["e1"])),
    },
    now: () => now,
  };
  return { queue: createReviewQueue(deps), calls };
}

test("reviews follow the signed-in owner", async () => {
  for (const [user, ownerId] of [
    [member, "password:abc"],
    [actingAdmin, "password:abc"],
    [demo, "demo:1"],
  ] as const) {
    const { queue, calls } = setup(user);
    await queue.listDue(20);
    assert.equal(await queue.countDue(), 3);
    assert.deepEqual(await queue.entriesInReview(), new Set(["e1"]));
    assert.equal(await queue.answer({ itemId, logId, rating: 3 }), true);
    assert.deepEqual(
      calls.map((call) => [call[0], call[1]]),
      [
        ["countDueByKind", ownerId],
        ["listDue", ownerId],
        ["reviewedDates", ownerId],
        ["countDue", ownerId],
        ["entryIdsInReview", ownerId],
        ["answer", ownerId],
      ],
    );
    assert.deepEqual(calls.at(-1), ["answer", ownerId, itemId, logId, 3, now]);
  }

  for (const user of [null, guest, revoked, noGithubId]) {
    const { queue, calls } = setup(user);
    await assert.rejects(queue.listDue(20), ReviewForbiddenError);
    await assert.rejects(queue.countDue(), ReviewForbiddenError);
    await assert.rejects(queue.entriesInReview(), ReviewForbiddenError);
    await assert.rejects(
      queue.answer({ itemId, logId, rating: 3 }),
      ReviewForbiddenError,
    );
    assert.deepEqual(calls, []);
  }
});

test("listDue sums the kinds and works out each answer's next due from one now", async () => {
  const { queue, calls } = setup(member);
  const due = await queue.listDue(20);
  assert.deepEqual(calls, [
    ["countDueByKind", "password:abc", now],
    ["listDue", "password:abc", now, 20],
    // JST midnight 400 days before 2026-11-16.
    ["reviewedDates", "password:abc", new Date("2025-10-11T15:00:00.000Z")],
  ]);
  assert.equal(due.count, 3);
  assert.deepEqual(due.byKind, { preposition: 2, entry: 1 });
  assert.equal(due.streakDays, 2);
  assert.deepEqual(due.recentDays, [
    false,
    false,
    false,
    true,
    false,
    true,
    true,
  ]);
  assert.deepEqual(due.items, [
    {
      id: "c000000000000000000000001",
      language: "zh",
      kind: "preposition",
      targetId: "P001:学校",
      due: now,
      state: 0,
      reps: 0,
      lapses: 0,
      lastReview: null,
      vocabulary: null,
      entry: null,
      nextDue: nextFsrsDues(newCard, now),
    },
    {
      id: "c000000000000000000000002",
      language: "zh",
      kind: "preposition",
      targetId: "P001:学校",
      due: now,
      state: 2,
      reps: 0,
      lapses: 0,
      lastReview: brokenCard.lastReview,
      vocabulary: null,
      entry: null,
      nextDue: null,
    },
  ]);
  assert.notEqual(due.items[0].nextDue, null);
  // The first card's dues were worked out from the same now.
  assert.deepEqual(due.items[0].nextDue?.[0], new Date(now.getTime() + 60_000));
});

test("listDue only takes a limit from 1 to 100", async () => {
  const { queue, calls } = setup(member);
  for (const limit of [0, 101, 1.5])
    await assert.rejects(queue.listDue(limit), RangeError);
  assert.deepEqual(calls, []);
});

test("an answer to an item id of the wrong shape is not found without asking the store", async () => {
  const { queue, calls } = setup(member);
  for (const id of ["", "not-an-id", "cABCDEFGHIJKLMNOPQRSTUVWX"])
    assert.equal(await queue.answer({ itemId: id, logId, rating: 3 }), false);
  assert.deepEqual(calls, []);
});
