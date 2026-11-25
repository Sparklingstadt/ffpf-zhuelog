// FSRS-6, the spaced-repetition scheduler, from the ts-fsrs library: its
// default weights, a recall rate of 0.9, learning steps of 1 and 10 minutes,
// one relearning step of 10 minutes, and no fuzz. Nothing here is random, so
// the same card and time always give the same answer.
//
// This file only translates between the app's card (the columns of
// ReviewItem) and the library's, and turns the library's refusals into
// FsrsError.
import {
  dateChrono,
  defineScheduler,
  schedulerDesiredRetentionMiddleware,
  schedulerFuzzingMiddleware,
  schedulerLearningStepsMiddleware,
  schedulerMaximumIntervalMiddleware,
  schedulerMonotonicIntervalMiddleware,
  schedulerScheduledDaysMiddleware,
  schedulerStatsMiddleware,
} from "ts-fsrs";
import {
  FSRS6Model,
  FSRS6_DEFAULT_WEIGHTS,
  migrateFSRS6Parameters,
} from "ts-fsrs/models/fsrs-6";

// 0 new, 1 learning, 2 review, 3 relearning (the library's numbers too).
export type FsrsState = 0 | 1 | 2 | 3;

export type FsrsCard = {
  due: Date;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: number; // checked to be an FsrsState
  // How many learning (or relearning) steps the card has left; 0 outside
  // them. The library counts the other way, from the first step.
  remainingSteps: number;
  lastReview: Date | null;
};

// A rating, card or time FSRS cannot schedule, or a result it refuses.
export class FsrsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FsrsError";
  }
}

const NEW = 0;
const LEARNING = 1;
const RELEARNING = 3;

const AGAIN = 1;
const EASY = 4;

const LEARNING_STEPS = ["1m", "10m"] as const;
const RELEARNING_STEPS = ["10m"] as const;

// The bounds below which a stored stability or difficulty is not a card.
const S_MIN = 0.001;
const D_MIN = 1;

// The library's scheduling status for each state: relearning is "learning".
const SCHEDULE_STATUS = ["new", "learning", "review", "learning"] as const;

// The scheduler ts-fsrs's DefaultScheduler({ version: "FSRS-6" }) builds, with
// the same policies in the same order. It is built here rather than awaited
// from DefaultScheduler, which loads the model asynchronously, so that
// scheduling stays a plain function. tests/review-fsrs.test.ts checks that
// both give the same answers.
const scheduler = defineScheduler({ model: FSRS6Model, chrono: dateChrono })
  .use(
    schedulerDesiredRetentionMiddleware,
    schedulerFuzzingMiddleware,
    schedulerStatsMiddleware,
    schedulerScheduledDaysMiddleware,
    schedulerLearningStepsMiddleware,
    schedulerMaximumIntervalMiddleware,
    schedulerMonotonicIntervalMiddleware,
  )
  .create({
    config: {
      fractionalDays: false,
      weights: migrateFSRS6Parameters(Array.from(FSRS6_DEFAULT_WEIGHTS)),
      enableShortTerm: true,
      numRelearningSteps: RELEARNING_STEPS.length,
      desiredRetention: 0.9,
      learningSteps: [...LEARNING_STEPS],
      relearningSteps: [...RELEARNING_STEPS],
      allowModelOverride: false,
      enableFuzz: false,
      maximumInterval: 36500,
    },
  });

type LibraryCard = Parameters<typeof scheduler.review>[0]["card"];

function isFsrsState(state: number): state is FsrsState {
  return Number.isInteger(state) && state >= NEW && state <= RELEARNING;
}

function stepCount(state: number): number {
  if (state === LEARNING) return LEARNING_STEPS.length;
  if (state === RELEARNING) return RELEARNING_STEPS.length;
  return 0;
}

function isValidTime(t: Date): boolean {
  return !Number.isNaN(t.getTime());
}

// Throws for a card the app should never have stored, or an answer given
// before the card's last review, which the library would schedule from.
function validateCard(card: FsrsCard, now: Date) {
  if (!isFsrsState(card.state)) {
    throw new FsrsError(`invalid card state: ${card.state}`);
  }
  if (card.state !== NEW) {
    if (!Number.isFinite(card.stability) || card.stability < S_MIN) {
      throw new FsrsError(`invalid stability: ${card.stability}`);
    }
    if (!Number.isFinite(card.difficulty) || card.difficulty < D_MIN) {
      throw new FsrsError(`invalid difficulty: ${card.difficulty}`);
    }
  }
  if (!isValidTime(now)) throw new FsrsError("invalid time");
  if (card.lastReview !== null) {
    if (!isValidTime(card.lastReview)) {
      throw new FsrsError("invalid last review");
    }
    if (card.lastReview > now) {
      throw new FsrsError("last review is after the answer");
    }
  }
}

function toLibrary(card: FsrsCard & { state: FsrsState }): LibraryCard {
  return {
    // Fuzz is off, so the id plays no part in the answer.
    cardId: "card",
    state: card.state,
    scheduleStatus: SCHEDULE_STATUS[card.state],
    dueAt: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    // A negative count is read as 0.
    scheduledDays: Math.max(card.scheduledDays, 0),
    reps: Math.max(card.reps, 0),
    lapses: Math.max(card.lapses, 0),
    learningStep: Math.max(stepCount(card.state) - card.remainingSteps, 0),
    lastReviewAt: card.lastReview,
  };
}

function fromLibrary(card: LibraryCard): FsrsCard {
  return {
    due: card.dueAt,
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    remainingSteps: Math.max(
      stepCount(card.state) - (card.learningStep ?? 0),
      0,
    ),
    lastReview: card.lastReviewAt ?? null,
  };
}

// A card that has never been reviewed, due at now.
export function newFsrsCard(now: Date): FsrsCard {
  return {
    due: new Date(now.getTime()),
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: NEW,
    remainingSteps: 0,
    lastReview: null,
  };
}

// The card after an answer rated `rating` (1..4) at `now`. Throws FsrsError.
export function nextFsrsCard(
  card: FsrsCard,
  rating: number,
  now: Date,
): FsrsCard {
  if (!Number.isInteger(rating) || rating < AGAIN || rating > EASY) {
    throw new FsrsError(`invalid rating: ${rating}`);
  }
  validateCard(card, now);
  const state = card.state as FsrsState;
  let next: LibraryCard;
  try {
    next = scheduler.review({
      card: toLibrary({ ...card, state }),
      grade: rating as 1 | 2 | 3 | 4,
      now,
    }).card;
  } catch (error) {
    throw new FsrsError(
      `FSRS refused the answer: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return fromLibrary(next);
}

// When each rating, もう一度 to 簡単, would bring the card back; null when
// FSRS refuses the card (the due list then shows no intervals).
export function nextFsrsDues(
  card: FsrsCard,
  now: Date,
): readonly [Date, Date, Date, Date] | null {
  try {
    return [
      nextFsrsCard(card, 1, now).due,
      nextFsrsCard(card, 2, now).due,
      nextFsrsCard(card, 3, now).due,
      nextFsrsCard(card, 4, now).due,
    ];
  } catch (error) {
    if (error instanceof FsrsError) return null;
    throw error;
  }
}
