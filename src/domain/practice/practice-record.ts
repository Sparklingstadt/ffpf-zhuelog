// A finished practice round, as the web saves it for members and admins.
// Every practice shares these shapes; complement rounds add their mode.

// One question of the round and the wrong choices picked before the
// answer, in the order they were picked. id is the question's id in the
// practice data; rounds saved before it was kept have none.
export type ChoiceAnswer = {
  id?: string;
  answer: string;
  noun: string;
  prompt: string;
  misses: string[];
};

export type RoundScore = {
  questionCount: number;
  // Questions answered without a miss.
  firstTryCount: number;
  // Every wrong pick.
  missCount: number;
};

export type PracticeRecordSummary = RoundScore & {
  id: string;
  elapsedMs: number;
  startedAt: Date;
  createdAt: Date;
};

export type PracticeRecord = PracticeRecordSummary & {
  questions: ChoiceAnswer[];
};

// What a round keeps of a question once it is answered.
export function answerOf(
  question: Pick<ChoiceAnswer, "id" | "answer" | "noun" | "prompt">,
  misses: string[],
): ChoiceAnswer {
  return {
    id: question.id,
    answer: question.answer,
    noun: question.noun,
    prompt: question.prompt,
    misses,
  };
}

// Counted from the questions when the round is saved.
export function scoreRound(
  answers: readonly { misses: readonly string[] }[],
): RoundScore {
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
