// The four-choice question every practice mode and today's review ask, and
// the helpers they share. This module must not import any question data: the
// browser loads it, and the data (hundreds of KB) stays on the server.

export const BLANK = "（　）";

export const CHOICE_COUNT = 4;

// How many questions a practice round asks.
export const PRACTICE_QUESTION_COUNT = 25;

export type ChoiceQuestion = {
  id: string;
  // The word the question is about: a noun, a verb or a complement's head.
  noun: string;
  meaning: string;
  // The phrase with the answer left out as BLANK.
  prompt: string;
  phrase: string;
  answer: string;
  pinyin: string;
  example: string;
  // Pinyin of the whole example; empty when the sentence has none yet.
  examplePinyin: string;
  translation: string;
  // CHOICE_COUNT choices in display order; exactly one is the answer.
  choices: string[];
};

// A random number in [0, 1), as Math.random returns.
export type Random = () => number;

export function shuffled<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// How far the progress bar reaches, 0 to 100.
export function progressPercent(done: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (done / total) * 100));
}
