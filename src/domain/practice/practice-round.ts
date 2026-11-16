// Checking a finished round before it is saved, the shape it is saved in,
// and which of its questions go to the review queue. The rules are the ones
// the Go API had, so rows written by either side read the same.
import {
  COMPLEMENT_ROUND_MODES,
  type ComplementRoundMode,
} from "./complement-record";
import {
  type ChoiceAnswer,
  type RoundScore,
  scoreRound,
} from "./practice-record";

export type PracticeKind = "preposition" | "complement";

export const PRACTICE_RECORD_LIST_LIMIT = 100;

// A lower-case UUID, as the browser's crypto.randomUUID() makes them.
export const PRACTICE_RECORD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const PRACTICE_ROUND_LIMITS = {
  questions: 50,
  misses: 3,
  id: 40,
  noun: 40,
  prompt: 100,
  elapsedMs: 86_400_000,
  answer: { preposition: 10, complement: 40 },
} as const;

export type PracticeRound = {
  id: string;
  startedAt: Date;
  elapsedMs: number;
  questions: readonly ChoiceAnswer[];
};
export type ComplementRound = PracticeRound & { mode: ComplementRoundMode };

// A round as it is saved: questions copied (an empty id dropped, misses
// copied) and counted.
export type CheckedRound = {
  id: string;
  startedAt: Date;
  elapsedMs: number;
  questions: ChoiceAnswer[];
} & RoundScore;

// Lengths are counted in code points, as Go counted runes, so a character
// outside the BMP (two UTF-16 units) counts once.
const length = (s: string) => [...s].length;

// Non-empty and at most max characters (the rule the Go API used to apply;
// see docs/superpowers/plans/2026-11-16-deprecate-go-stage5-go-reference.md).
const bounded = (s: string, max: number) => {
  const n = length(s);
  return n > 0 && n <= max;
};

function isComplementRoundMode(mode: unknown): mode is ComplementRoundMode {
  return (COMPLEMENT_ROUND_MODES as readonly unknown[]).includes(mode);
}

// The round's numeric bounds (the rule the Go API used to apply).
function validRound(
  maxAnswer: number,
  elapsedMs: number,
  questions: readonly ChoiceAnswer[],
) {
  const limits = PRACTICE_ROUND_LIMITS;
  if (
    !Number.isInteger(elapsedMs) ||
    elapsedMs < 0 ||
    elapsedMs > limits.elapsedMs
  ) {
    return false;
  }
  if (questions.length === 0 || questions.length > limits.questions) {
    return false;
  }
  return questions.every((q) => {
    if (
      length(q.id ?? "") > limits.id ||
      !bounded(q.answer, maxAnswer) ||
      !bounded(q.noun, limits.noun) ||
      !bounded(q.prompt, limits.prompt) ||
      q.misses.length > limits.misses
    ) {
      return false;
    }
    const seen = new Set<string>();
    return q.misses.every((m) => {
      if (!bounded(m, maxAnswer) || m === q.answer || seen.has(m)) {
        return false;
      }
      seen.add(m);
      return true;
    });
  });
}

// A question as the row keeps it: the id only when it has one.
function savedQuestion(q: ChoiceAnswer): ChoiceAnswer {
  const saved: ChoiceAnswer = {
    answer: q.answer,
    noun: q.noun,
    prompt: q.prompt,
    misses: [...q.misses],
  };
  if (q.id) saved.id = q.id;
  return saved;
}

// The checks on a submitted round and the counting of its questions, as the
// Go API used to do them (see docs/superpowers/plans/2026-11-16-deprecate-go-stage5-go-reference.md).
// null when the round must be refused.
export function checkPracticeRound(
  kind: "preposition",
  round: PracticeRound & { mode?: unknown },
): CheckedRound | null;
export function checkPracticeRound(
  kind: "complement",
  round: PracticeRound & { mode: unknown },
): (CheckedRound & { mode: ComplementRoundMode }) | null;
export function checkPracticeRound(
  kind: PracticeKind,
  round: PracticeRound & { mode?: unknown },
): (CheckedRound & { mode?: ComplementRoundMode }) | null {
  if (!PRACTICE_RECORD_ID.test(round.id)) return null;
  if (Number.isNaN(round.startedAt.getTime())) return null;
  // A preposition round has no mode: Go refused the key as unknown.
  if (
    kind === "complement"
      ? !isComplementRoundMode(round.mode)
      : round.mode !== undefined
  ) {
    return null;
  }
  if (
    !validRound(
      PRACTICE_ROUND_LIMITS.answer[kind],
      round.elapsedMs,
      round.questions,
    )
  ) {
    return null;
  }
  const questions = round.questions.map(savedQuestion);
  const checked: CheckedRound = {
    id: round.id,
    startedAt: round.startedAt,
    elapsedMs: round.elapsedMs,
    questions,
    ...scoreRound(questions),
  };
  return kind === "complement"
    ? { ...checked, mode: round.mode as ComplementRoundMode }
    : checked;
}

export type PracticeReviewTarget = {
  language: "zh";
  kind: PracticeKind;
  targetId: string;
};

// Which missed questions become review targets (the rule the Go API used to
// apply; see docs/superpowers/plans/2026-11-16-deprecate-go-stage5-go-reference.md).
// The missed questions that name their question, once each, sorted by
// targetId so concurrent saves lock rows in the same order. A preposition's
// use has several phrases, so its target is the use and the noun ("P001:学校").
export function practiceReviewTargets(
  kind: PracticeKind,
  questions: readonly ChoiceAnswer[],
): PracticeReviewTarget[] {
  const targetIds = new Set<string>();
  for (const q of questions) {
    if (!q.id || q.misses.length === 0) continue;
    targetIds.add(kind === "preposition" ? `${q.id}:${q.noun}` : q.id);
  }
  return [...targetIds]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((targetId) => ({ language: "zh", kind, targetId }));
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

// Reads the questions column of a saved row back, as the Go API's scan did.
export function choiceAnswersFrom(json: unknown): ChoiceAnswer[] {
  if (!Array.isArray(json)) return [];
  return json.map((item: unknown) => {
    const q = (item ?? {}) as Record<string, unknown>;
    const answer: ChoiceAnswer = {
      answer: text(q.answer),
      noun: text(q.noun),
      prompt: text(q.prompt),
      misses: Array.isArray(q.misses)
        ? q.misses.filter((m): m is string => typeof m === "string")
        : [],
    };
    if (typeof q.id === "string" && q.id !== "") answer.id = q.id;
    return answer;
  });
}
