import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  type FsrsCard,
  FsrsError,
  newFsrsCard,
  nextFsrsCard,
  nextFsrsDues,
} from "../src/domain/review/fsrs";

// Written by the app's former Go implementation before it was removed; it is
// now a fixed file: what go-fsrs gives for each answer of each case.
type GoldenCard = {
  due: string;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: number;
  remainingSteps: number;
  lastReview: string | null;
};
type GoldenStep = {
  at: string;
  rating: number;
  nextDues: string[] | null;
  card: GoldenCard | null;
  error: boolean;
};
type GoldenCase = { name: string; start: GoldenCard; steps: GoldenStep[] };

const golden: { cases: GoldenCase[] } = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "fixtures", "fsrs-golden.json"),
    "utf8",
  ),
);

const start = new Date("2026-11-05T09:00:00.000Z");
const minute = 60_000;
const day = 24 * 60 * minute;

function fromGolden(card: GoldenCard): FsrsCard {
  return {
    ...card,
    due: new Date(card.due),
    lastReview: card.lastReview === null ? null : new Date(card.lastReview),
  };
}

function iso(card: FsrsCard) {
  return {
    ...card,
    due: card.due.toISOString(),
    lastReview: card.lastReview?.toISOString() ?? null,
  };
}

// The golden file and V8 may differ in the last digit of exp and pow.
function assertClose(actual: number, expected: number, where: string) {
  const error = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(error <= 1e-9, `${where}: ${actual} is not ${expected}`);
}

function assertSameCard(actual: FsrsCard, expected: GoldenCard, where: string) {
  const { stability, difficulty, ...rest } = iso(actual);
  const {
    stability: wantStability,
    difficulty: wantDifficulty,
    ...wantRest
  } = expected;
  assert.deepEqual(rest, wantRest, where);
  assertClose(stability, wantStability, `${where} stability`);
  assertClose(difficulty, wantDifficulty, `${where} difficulty`);
}

function goldenCase(name: string): GoldenCase {
  const found = golden.cases.find((c) => c.name === name);
  assert.ok(found, `no golden case ${name}`);
  return found;
}

// Answers the case's steps with the port and returns each card.
function replay(name: string): FsrsCard[] {
  const c = goldenCase(name);
  let card = fromGolden(c.start);
  return c.steps.map((step) => {
    card = nextFsrsCard(card, step.rating, new Date(step.at));
    return card;
  });
}

// Good when due until the card leaves the learning steps; the card and the
// time of the last answer.
function graduate(): { card: FsrsCard; at: Date } {
  let card = newFsrsCard(start);
  let at = start;
  for (let i = 0; card.state !== 2; i++) {
    assert.ok(i <= 10, "still learning after 10 answers");
    at = card.due;
    card = nextFsrsCard(card, 3, at);
  }
  return { card, at };
}

test("matches every answer scheduled in the golden file", () => {
  assert.ok(golden.cases.length >= 15);
  for (const c of golden.cases) {
    let card = fromGolden(c.start);
    c.steps.forEach((step, i) => {
      const where = `${c.name} step ${i + 1}`;
      const at = new Date(step.at);
      assert.deepEqual(
        nextFsrsDues(card, at)?.map((d) => d.toISOString()) ?? null,
        step.nextDues,
        `${where} nextDues`,
      );
      if (step.error) {
        assert.throws(
          () => nextFsrsCard(card, step.rating, at),
          FsrsError,
          where,
        );
        return;
      }
      assert.ok(step.card, `${where} has no card`);
      const next = nextFsrsCard(card, step.rating, at);
      assertSameCard(next, step.card, where);
      card = next;
    });
  }
});

test("a new card is due at once", () => {
  assert.deepEqual(newFsrsCard(start), {
    due: start,
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    remainingSteps: 0,
    lastReview: null,
  });
});

test("the first answer schedules by rating", () => {
  const due = [1, 2, 3, 4].map((rating) => {
    const card = nextFsrsCard(newFsrsCard(start), rating, start);
    assert.equal(card.reps, 1);
    assert.deepEqual(card.lastReview, start);
    assert.ok(card.due > start);
    assert.notEqual(card.state, 0);
    return card.due.getTime();
  });
  const [again, hard, good, easy] = due;
  assert.ok(again < good && hard <= good && good < easy, `${due}`);
});

test("good answers spread the reviews", () => {
  let { card, at } = graduate();
  let prev = card.due.getTime() - at.getTime();
  for (let i = 0; i < 4; i++) {
    at = card.due;
    card = nextFsrsCard(card, 3, at);
    const gap = card.due.getTime() - at.getTime();
    assert.ok(gap > prev, `review ${i}: gap ${gap} did not grow past ${prev}`);
    prev = gap;
  }
  assert.ok(prev >= 7 * day, `after four more Good answers the gap is ${prev}`);
});

test("again on a review card is a lapse", () => {
  const { card } = graduate();
  const now = card.due;
  const again = nextFsrsCard(card, 1, now);
  assert.equal(again.lapses, card.lapses + 1);
  assert.equal(again.state, 3);
  assert.ok(again.due.getTime() < now.getTime() + day);
  const good = nextFsrsCard(card, 3, now);
  assert.equal(good.lapses, card.lapses);
  assert.ok(again.due < good.due);
});

test("better answers never come back sooner", () => {
  const now = new Date("2026-11-11T09:00:00.000Z");
  const card = newFsrsCard(now);
  const dues = nextFsrsDues(card, now);
  assert.ok(dues);
  dues.forEach((due, i) => {
    assert.deepEqual(due, nextFsrsCard(card, i + 1, now).due);
    if (i > 0) assert.ok(due >= dues[i - 1], `rating ${i + 1}`);
  });
});

test("elapsed days follow UTC dates, not Japan dates", () => {
  // Again, Good a minute later, then Good two minutes after that: across
  // UTC midnight a day has passed, across Japan's midnight (15:00Z) none has.
  const acrossUtc = replay("utc-day-boundary");
  const acrossJst = replay("jst-midnight-same-utc-day");
  assert.equal(acrossUtc[1].stability, acrossJst[1].stability);
  assert.notEqual(acrossUtc[2].stability, acrossJst[2].stability);
  assert.equal(acrossUtc[2].scheduledDays, 2);
  assert.equal(acrossJst[2].scheduledDays, 1);
});

test("refuses ratings, states and times outside the scheduler's range", () => {
  const card = nextFsrsCard(newFsrsCard(start), 3, start);
  const later = new Date(start.getTime() + 10 * minute);
  for (const rating of [-1, 2.5, Number.NaN]) {
    assert.throws(() => nextFsrsCard(card, rating, later), FsrsError);
  }
  for (const state of [-1, 4, 1.5]) {
    assert.throws(() => nextFsrsCard({ ...card, state }, 3, later), FsrsError);
  }
  assert.throws(() => nextFsrsCard(card, 3, new Date(Number.NaN)), FsrsError);
  assert.equal(nextFsrsDues(card, new Date(Number.NaN)), null);
});
