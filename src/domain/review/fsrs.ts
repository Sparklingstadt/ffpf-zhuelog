// FSRS, the spaced-repetition scheduler, as Go's review package runs it:
// go-fsrs v4.0.0 (github.com/open-spaced-repetition/go-fsrs) with its default
// parameters, the short-term ("basic") scheduler and no fuzz. Nothing here is
// random, so the same card and time give the same answer as Go; the golden
// file Go writes (tests/fixtures/fsrs-golden.json) holds both to it.

// 0 new, 1 learning, 2 review, 3 relearning (go-fsrs's numbers).
export type FsrsState = 0 | 1 | 2 | 3;

export type FsrsCard = {
  due: Date;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: number; // checked to be an FsrsState
  remainingSteps: number;
  lastReview: Date | null;
};

// A rating, card or time FSRS cannot schedule, or a result it refuses.
export class FsrsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FsrsError";
  }
}

const NEW = 0;
const LEARNING = 1;
const REVIEW = 2;
const RELEARNING = 3;

const AGAIN = 1;
const HARD = 2;
const GOOD = 3;
const EASY = 4;

// go-fsrs weights.go DefaultWeights. No user has enough history to fit their
// own weights, so Go has always used these; NewFSRS's clipping leaves every
// one of them as it is.
const W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
  0.1542,
] as const;

// go-fsrs parameters.go DefaultParam
const REQUEST_RETENTION = 0.9;
const MAXIMUM_INTERVAL = 36500;
const LEARNING_STEPS = [1, 10] as const; // minutes
const RELEARNING_STEPS = [10] as const; // minutes

// go-fsrs arithmetic.go sMin, sMax, dMin, dMax
const S_MIN = 0.001;
const S_MAX = 36500;
const D_MIN = 1;
const D_MAX = 10;

// go-fsrs arithmetic.go decayAndFactor
const DECAY = -W[20];
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// go-fsrs arithmetic.go constrainStability
function constrainStability(s: number): number {
  return Math.min(Math.max(s, S_MIN), S_MAX);
}

// go-fsrs arithmetic.go constrainDifficulty
function constrainDifficulty(d: number): number {
  return Math.min(Math.max(d, D_MIN), D_MAX);
}

// go-fsrs arithmetic.go initStability
function initStability(r: number): number {
  return Math.min(Math.max(W[r - 1], 0.1), S_MAX);
}

// go-fsrs arithmetic.go initDifficulty (callers constrain it)
function initDifficulty(r: number): number {
  return W[4] - Math.exp(W[5] * (r - 1)) + 1;
}

// go-fsrs arithmetic.go nextDifficulty (with linearDamping and meanReversion)
function nextDifficulty(d: number, r: number): number {
  const deltaD = -W[6] * (r - 3);
  const nextD = d + ((10 - d) * deltaD) / 9;
  return constrainDifficulty(W[7] * initDifficulty(EASY) + (1 - W[7]) * nextD);
}

// go-fsrs arithmetic.go shortTermStability
function shortTermStability(stability: number, r: number): number {
  const s = constrainStability(stability);
  let sinc = Math.exp(W[17] * (r - 3 + W[18])) * Math.pow(s, -W[19]);
  if (r >= HARD && sinc < 1) sinc = 1;
  return constrainStability(s * sinc);
}

// go-fsrs parameters.go ForgettingCurve
function forgettingCurve(elapsedDays: number, stability: number): number {
  return Math.pow(
    1 + (FACTOR * elapsedDays) / constrainStability(stability),
    DECAY,
  );
}

// go-fsrs arithmetic.go nextRecallStability
function nextRecallStability(
  d: number,
  s: number,
  retrievability: number,
  r: number,
): number {
  const hardPenalty = r === HARD ? W[15] : 1;
  const easyBonus = r === EASY ? W[16] : 1;
  return constrainStability(
    s *
      (1 +
        Math.exp(W[8]) *
          (11 - d) *
          Math.pow(s, -W[9]) *
          (Math.exp((1 - retrievability) * W[10]) - 1) *
          hardPenalty *
          easyBonus),
  );
}

// go-fsrs arithmetic.go nextForgetStability (short-term on)
function nextForgetStability(
  d: number,
  s: number,
  retrievability: number,
): number {
  const newS =
    W[11] *
    Math.pow(d, -W[12]) *
    (Math.pow(s + 1, W[13]) - 1) *
    Math.exp((1 - retrievability) * W[14]);
  return constrainStability(Math.min(newS, s / Math.exp(W[17] * W[18])));
}

// go-fsrs arithmetic.go nextInterval (fuzz off), in whole days. Go's
// math.Round and Math.round agree: the value is always positive.
function nextInterval(stability: number): number {
  const s = constrainStability(stability);
  const interval = (s / FACTOR) * (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1);
  return Math.max(Math.min(Math.round(interval), MAXIMUM_INTERVAL), 1);
}

// go-fsrs steps.go dateDiffInDays: whole days between the UTC dates.
function dateDiffInDays(last: Date, now: Date): number {
  const utcDate = (t: Date) =>
    Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  const ms = utcDate(now) - utcDate(last);
  return ms < 0 ? 0 : Math.floor(ms / DAY_MS);
}

// go-fsrs steps.go againDelayMinutes
function againDelayMinutes(steps: readonly number[]): number {
  return steps.length === 0 ? 0 : steps[0];
}

// go-fsrs steps.go hardDelayMinutes
function hardDelayMinutes(steps: readonly number[]): number {
  if (steps.length === 0) return 0;
  if (steps.length === 1) return Math.round(steps[0] * 1.5);
  return Math.round((steps[0] + steps[1]) / 2);
}

// go-fsrs steps.go goodDelayMinutes: null when the card graduates.
function goodDelayMinutes(
  steps: readonly number[],
  remaining: number,
): number | null {
  const nextIdx = steps.length - remaining + 1;
  if (nextIdx < 0 || nextIdx >= steps.length) return null;
  return steps[nextIdx];
}

// One answer in progress: the card before it (last), and the card as it
// starts out after it (current: one more rep, reviewed now).
type Pass = { last: FsrsCard; current: FsrsCard; now: Date };

// go-fsrs scheduler.go elapsedDays
function elapsedDays({ last, now }: Pass): number {
  if (last.state === NEW || last.lastReview === null) return 0;
  return dateDiffInDays(last.lastReview, now);
}

// go-fsrs scheduler_basic.go applyStep
function applyStep(
  pass: Pass,
  next: FsrsCard,
  delayMinutes: number,
  toState: FsrsState,
): FsrsCard {
  const due = new Date(pass.now.getTime() + delayMinutes * MINUTE_MS);
  // No step is a day long, but go-fsrs makes such a step a review.
  if (delayMinutes >= 1440) {
    return {
      ...next,
      due,
      scheduledDays: Math.floor(delayMinutes / 1440),
      state: REVIEW,
    };
  }
  return { ...next, due, scheduledDays: 0, state: toState };
}

// go-fsrs steps.go daysToDuration, added to now.
function dueInDays(pass: Pass, days: number): Date {
  return new Date(
    pass.now.getTime() + Math.min(days, MAXIMUM_INTERVAL) * DAY_MS,
  );
}

// go-fsrs scheduler_basic.go graduateToReview
function graduateToReview(pass: Pass, next: FsrsCard): FsrsCard {
  const interval = nextInterval(next.stability);
  return {
    ...next,
    scheduledDays: interval,
    due: dueInDays(pass, interval),
    state: REVIEW,
    remainingSteps: 0,
  };
}

// go-fsrs scheduler_basic.go newState
function answerNew(pass: Pass, r: number): FsrsCard {
  const next: FsrsCard = {
    ...pass.current,
    difficulty: constrainDifficulty(initDifficulty(r)),
    stability: initStability(r),
  };
  const steps = LEARNING_STEPS;
  switch (r) {
    case AGAIN:
      return applyStep(
        pass,
        { ...next, remainingSteps: steps.length },
        againDelayMinutes(steps),
        LEARNING,
      );
    case HARD:
      return applyStep(
        pass,
        { ...next, remainingSteps: steps.length },
        hardDelayMinutes(steps),
        LEARNING,
      );
    case GOOD: {
      const delay = goodDelayMinutes(steps, steps.length);
      if (delay === null) return graduateToReview(pass, next);
      return applyStep(
        pass,
        { ...next, remainingSteps: steps.length - 1 },
        delay,
        LEARNING,
      );
    }
    default:
      return graduateToReview(pass, next);
  }
}

// go-fsrs scheduler_basic.go learningState (with computeLearningStability)
function answerLearning(pass: Pass, r: number): FsrsCard {
  const { last } = pass;
  const elapsed = elapsedDays(pass);
  let stability: number;
  if (elapsed === 0) {
    stability = shortTermStability(last.stability, r);
  } else {
    const retrievability = forgettingCurve(elapsed, last.stability);
    stability =
      r === AGAIN
        ? nextForgetStability(last.difficulty, last.stability, retrievability)
        : nextRecallStability(
            last.difficulty,
            last.stability,
            retrievability,
            r,
          );
  }
  const next: FsrsCard = {
    ...pass.current,
    difficulty: nextDifficulty(last.difficulty, r),
    stability,
  };
  const relearning = last.state === RELEARNING;
  const steps = relearning ? RELEARNING_STEPS : LEARNING_STEPS;
  const toState = relearning ? RELEARNING : LEARNING;
  const remaining = pass.current.remainingSteps;

  switch (r) {
    case AGAIN:
      if (remaining <= 0) return graduateToReview(pass, next);
      return applyStep(
        pass,
        { ...next, remainingSteps: steps.length },
        againDelayMinutes(steps),
        toState,
      );
    case HARD:
      if (remaining <= 0) return graduateToReview(pass, next);
      return applyStep(pass, next, hardDelayMinutes(steps), toState);
    case GOOD: {
      const delay = goodDelayMinutes(steps, remaining);
      if (delay === null) return graduateToReview(pass, next);
      return applyStep(
        pass,
        { ...next, remainingSteps: remaining - 1 },
        delay,
        toState,
      );
    }
    default:
      return graduateToReview(pass, next);
  }
}

// go-fsrs scheduler_basic.go reviewState (with Scheduler.nextDs)
function answerReview(pass: Pass, r: number): FsrsCard {
  const { last, current } = pass;
  const elapsed = elapsedDays(pass);
  const retrievability =
    elapsed === 0 ? 0 : forgettingCurve(elapsed, last.stability);
  const memory = (rating: number): FsrsCard => ({
    ...current,
    difficulty: nextDifficulty(last.difficulty, rating),
    stability:
      elapsed === 0
        ? shortTermStability(last.stability, rating)
        : rating === AGAIN
          ? nextForgetStability(last.difficulty, last.stability, retrievability)
          : nextRecallStability(
              last.difficulty,
              last.stability,
              retrievability,
              rating,
            ),
  });

  if (r === AGAIN) {
    const again = applyStep(
      pass,
      { ...memory(AGAIN), remainingSteps: RELEARNING_STEPS.length },
      againDelayMinutes(RELEARNING_STEPS),
      RELEARNING,
    );
    return { ...again, lapses: again.lapses + 1 };
  }

  const hard = memory(HARD);
  const good = memory(GOOD);
  const easy = memory(EASY);
  const goodRaw = nextInterval(good.stability);
  const hardInterval = Math.min(nextInterval(hard.stability), goodRaw);
  const goodInterval = Math.max(goodRaw, hardInterval + 1);
  const easyInterval = Math.max(nextInterval(easy.stability), goodInterval + 1);
  const [next, days] =
    r === HARD
      ? [hard, hardInterval]
      : r === GOOD
        ? [good, goodInterval]
        : [easy, easyInterval];
  return {
    ...next,
    scheduledDays: days,
    due: dueInDays(pass, days),
    state: REVIEW,
    remainingSteps: 0,
  };
}

function isFsrsState(state: number): state is FsrsState {
  return Number.isInteger(state) && state >= NEW && state <= RELEARNING;
}

function isValidTime(t: Date): boolean {
  return !Number.isNaN(t.getTime());
}

// go-fsrs validate.go validateCard, plus times Go cannot hold.
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

// go-fsrs validate.go validateResult
function validateResult(card: FsrsCard) {
  if (!Number.isFinite(card.stability) || card.stability < S_MIN) {
    throw new FsrsError(`computed stability is invalid: ${card.stability}`);
  }
  if (!Number.isFinite(card.difficulty) || card.difficulty < D_MIN) {
    throw new FsrsError(`computed difficulty is invalid: ${card.difficulty}`);
  }
}

// A card that has never been reviewed, due at now (review.go NewCard).
export function newFsrsCard(now: Date): FsrsCard {
  return {
    due: now,
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
// (review.go Next, go-fsrs fsrs.go Next and scheduler.go newScheduler)
export function nextFsrsCard(
  card: FsrsCard,
  rating: number,
  now: Date,
): FsrsCard {
  if (!Number.isInteger(rating) || rating < AGAIN || rating > EASY) {
    throw new FsrsError(`invalid rating: ${rating}`);
  }
  validateCard(card, now);
  // review.go toFSRS: go-fsrs keeps these counts unsigned.
  const last: FsrsCard = {
    ...card,
    scheduledDays: Math.max(card.scheduledDays, 0),
    reps: Math.max(card.reps, 0),
    lapses: Math.max(card.lapses, 0),
  };
  const pass: Pass = {
    last,
    current: { ...last, reps: last.reps + 1, lastReview: now },
    now,
  };
  const next =
    last.state === NEW
      ? answerNew(pass, rating)
      : last.state === REVIEW
        ? answerReview(pass, rating)
        : answerLearning(pass, rating);
  validateResult(next);
  return next;
}

// When each rating, もう一度 to 簡単, would bring the card back; null when
// FSRS refuses the card (the due list then shows no intervals).
export function nextFsrsDues(
  card: FsrsCard,
  now: Date,
): readonly [Date, Date, Date, Date] | null {
  try {
    return [
      nextFsrsCard(card, AGAIN, now).due,
      nextFsrsCard(card, HARD, now).due,
      nextFsrsCard(card, GOOD, now).due,
      nextFsrsCard(card, EASY, now).due,
    ];
  } catch (error) {
    if (error instanceof FsrsError) return null;
    throw error;
  }
}
