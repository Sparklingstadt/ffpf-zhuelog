import {
  hskLevelOf,
  inHskFilter,
  type HskBasis,
  type HskFilter,
  type HskLevel,
} from "./hsk-level";
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

// The phrase a question asks about, with the measure word in.
function phraseOf(usage: MeasureWordUsage): string {
  return usage.prompt.replace(BLANK, usage.answer);
}

// The HSK level of a question, decided by `basis` from its phrase and
// example sentence, as a preposition question's is.
export function measureWordUsageLevel(
  usage: MeasureWordUsage,
  basis: HskBasis,
): HskLevel {
  return hskLevelOf(basis, phraseOf(usage), usage.example);
}

function usagesAt(filter: HskFilter | null) {
  return MEASURE_WORD_USAGES.filter((usage) =>
    inHskFilter(filter, phraseOf(usage), usage.example),
  );
}

export function countMeasureWordQuestions(
  filter: HskFilter | null = null,
): number {
  return usagesAt(filter).length;
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
    phrase: phraseOf(usage),
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

// `count` questions in random order, only those of the filter's level when
// one is given. Built on the server first so hydration is deterministic;
// each retry builds a new order in the browser.
export function buildMeasureWordQuiz(
  count = 25,
  random: Random = Math.random,
  filter: HskFilter | null = null,
): PrepositionQuestion[] {
  return shuffled(usagesAt(filter), random)
    .slice(0, Math.max(0, Math.floor(count)))
    .map((usage) => measureWordQuestion(usage, random));
}
