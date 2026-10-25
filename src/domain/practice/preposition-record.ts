// A finished round of preposition practice, as the Go API keeps it for
// members and admins.

// One question of the round and the wrong prepositions picked before the
// answer, in the order they were picked.
export type PrepositionAnswer = {
  answer: string;
  noun: string;
  prompt: string;
  misses: string[];
};

export type PrepositionScore = {
  questionCount: number;
  // Questions answered without a miss.
  firstTryCount: number;
  // Every wrong pick.
  missCount: number;
};

export type PrepositionRecordSummary = PrepositionScore & {
  id: string;
  elapsedMs: number;
  startedAt: Date;
  createdAt: Date;
};

export type PrepositionRecord = PrepositionRecordSummary & {
  questions: PrepositionAnswer[];
};

// Counted as Go counts them when it saves the round.
export function scoreRound(
  answers: readonly { misses: readonly string[] }[],
): PrepositionScore {
  return {
    questionCount: answers.length,
    firstTryCount: answers.filter((answer) => answer.misses.length === 0)
      .length,
    missCount: answers.reduce((sum, answer) => sum + answer.misses.length, 0),
  };
}

// The share of questions answered on the first try, as a whole percent; null
// before any question is answered.
export function accuracyPercent(firstTry: number, answered: number) {
  if (answered <= 0) return null;
  return Math.round((firstTry / answered) * 100);
}

// "m:ss", or "h:mm:ss" from an hour on. Partial seconds are dropped.
export function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
