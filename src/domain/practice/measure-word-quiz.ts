import { MEASURE_WORD_USAGES } from "./measure-word-data";
import {
  BLANK,
  examplePinyinOf,
  type PrepositionQuestion,
  type Random,
} from "./preposition-quiz";

// One measure-word question: the noun, its Japanese meaning, the phrase it is
// counted in with BLANK where the measure word goes, and an example sentence
// containing that phrase.
export type MeasureWordUsage = {
  // "measure-NN". The record and the review queue keep it, so never reuse one.
  id: string;
  noun: string;
  meaning: string;
  prompt: string;
  answer: string;
  pinyin: string;
  // Four measure words, the answer among them; the others cannot count the
  // noun.
  choices: readonly string[];
  example: string;
  translation: string;
};

export const MEASURE_WORD_ID_PREFIX = "measure-";

export const MEASURE_WORD_PRACTICE = {
  label: "量詞",
  description:
    "名詞を数えるときの量詞を選びます。例：一本书（本1冊）、一张纸（紙1枚）、一辆车（車1台）。",
} as const;

export function isMeasureWordQuestionId(id: string): boolean {
  return id.startsWith(MEASURE_WORD_ID_PREFIX);
}

export function countMeasureWordQuestions(): number {
  return MEASURE_WORD_USAGES.length;
}

function shuffled<T>(values: readonly T[], random: Random): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// One question, its choices shuffled. The noun is shown large, as the
// preposition practice shows its noun.
export function measureWordQuestion(
  usage: MeasureWordUsage,
  random: Random = Math.random,
): PrepositionQuestion {
  return {
    id: usage.id,
    noun: usage.noun,
    meaning: usage.meaning,
    prompt: usage.prompt,
    phrase: usage.prompt.replace(BLANK, usage.answer),
    answer: usage.answer,
    pinyin: usage.pinyin,
    example: usage.example,
    examplePinyin: examplePinyinOf(usage.example),
    translation: usage.translation,
    choices: shuffled(usage.choices, random),
  };
}

// The question with this id, or null when the data no longer has it.
export function measureWordQuestionById(
  id: string,
  random: Random = Math.random,
): PrepositionQuestion | null {
  const usage = MEASURE_WORD_USAGES.find((u) => u.id === id);
  return usage ? measureWordQuestion(usage, random) : null;
}

// `count` questions in random order. Built on the server first so hydration
// is deterministic; each retry builds a new order in the browser.
export function buildMeasureWordQuiz(
  count = 25,
  random: Random = Math.random,
): PrepositionQuestion[] {
  return shuffled(MEASURE_WORD_USAGES, random)
    .slice(0, Math.max(0, Math.floor(count)))
    .map((usage) => measureWordQuestion(usage, random));
}
