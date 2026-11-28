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
  userId: "abc",
  role: "member",
  displayName: "taro",
  username: "taro",
};
const impersonated: AuthenticatedUser = {
  userId: "abc",
  role: "member",
  displayName: "太郎",
  username: "taro",
  impersonatedBy: "10001",
};
const demo: AuthenticatedUser = {
  userId: "demo1",
  role: "member",
  displayName: "demo",
  demo: true,
};
const guest: AuthenticatedUser = {
  userId: "g1",
  role: "guest",
  displayName: "g",
};

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
    [member, "abc"],
    [impersonated, "abc"],
    [demo, "demo1"],
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
        ["reviewedDates", ownerId],
        ["listDue", ownerId],
        ["countDue", ownerId],
        ["entryIdsInReview", ownerId],
        ["answer", ownerId],
      ],
    );
    assert.deepEqual(calls.at(-1), ["answer", ownerId, itemId, logId, 3, now]);
  }

  for (const user of [null, guest]) {
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
    ["countDueByKind", "abc", now],
    // JST midnight 400 days before 2026-11-16.
    ["reviewedDates", "abc", new Date("2025-10-11T15:00:00.000Z")],
    ["listDue", "abc", now, 20],
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

test("an answer with a logId that is not a lower-case UUID is refused without asking the store", async () => {
  const { queue, calls } = setup(member);
  for (const bad of ["", "not-a-uuid", logId.toUpperCase()])
    assert.equal(await queue.answer({ itemId, logId: bad, rating: 3 }), false);
  assert.deepEqual(calls, []);
});

test("dueSummary gives the home's numbers without reading any item", async () => {
  const { queue, calls } = setup(member);
  const summary = await queue.dueSummary();
  assert.deepEqual(calls, [
    ["countDueByKind", "abc", now],
    ["reviewedDates", "abc", new Date("2025-10-11T15:00:00.000Z")],
  ]);
  assert.deepEqual(summary, {
    count: 3,
    byKind: { preposition: 2, entry: 1 },
    streakDays: 2,
    recentDays: [false, false, false, true, false, true, true],
  });

  for (const user of [null, guest]) {
    const { queue, calls } = setup(user);
    await assert.rejects(queue.dueSummary(), ReviewForbiddenError);
    assert.deepEqual(calls, []);
  }
});

// The database may be far from the server, so reads that do not need each
// other's answer are asked for together.
test("listDue and dueSummary start their reads together", async () => {
  for (const [read, expected] of [
    ["listDue", ["countDueByKind", "reviewedDates", "listDue"]],
    ["dueSummary", ["countDueByKind", "reviewedDates"]],
  ] as const) {
    const started: string[] = [];
    let finished = 0;
    // No read finishes until the test lets it: every one must have started
    // by then.
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow =
      <R>(name: string, result: R) =>
      async () => {
        started.push(name);
        await gate;
        finished += 1;
        return result;
      };
    const queue = createReviewQueue({
      currentUser: async () => member,
      store: {
        countDue: slow("countDue", 0),
        countDueByKind: slow("countDueByKind", {}),
        listDue: slow("listDue", []),
        reviewedDates: slow("reviewedDates", []),
        answer: slow("answer", true),
        entryIdsInReview: slow("entryIdsInReview", new Set<string>()),
      },
      now: () => now,
    });
    const pending = read === "listDue" ? queue.listDue(20) : queue.dueSummary();
    // Lets the owner lookup and the calls' starts run.
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, expected);
    assert.equal(finished, 0);
    release();
    await pending;
  }
});
