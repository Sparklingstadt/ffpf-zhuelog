import { EXAMPLE_PINYIN } from "./example-pinyin";
import {
  hskLevelOf,
  inHskFilter,
  type HskBasis,
  type HskFilter,
  type HskLevel,
} from "./hsk-level";
import { PREPOSITION_USAGES } from "./preposition-data";

export type PrepositionCategory =
  | "場所・時間・起点"
  | "相手・対象・話題・比較"
  | "手段・道具・根拠・基準"
  | "原因・条件・除外・資格"
  | "処置・受け身・担当者";

// One use of a preposition, from a row of the preposition CSV.
export type PrepositionUsage = {
  id: string;
  preposition: string;
  pinyin: string;
  meaning: string;
  category: string;
  // Nouns this use takes, each in a phrase; `at` is where the preposition
  // starts in the phrase.
  pairs: readonly { noun: string; phrase: string; at: number }[];
  example: string;
  translation: string;
};

// Prepositions that also work in a category none of their CSV rows is in.
// 为 also gives a cause (为这件事生气); 由 is close to 由于; the direction
// words also point at a person (朝他笑, 冲着他喊).
const ALSO_IN: Record<string, readonly PrepositionCategory[]> = {
  为: ["原因・条件・除外・資格"],
  由: ["原因・条件・除外・資格"],
  朝: ["相手・対象・話題・比較"],
  朝着: ["相手・対象・話題・比較"],
  向着: ["相手・対象・話題・比較"],
  对着: ["相手・対象・話題・比較"],
  当着: ["相手・対象・話題・比較"],
  冲: ["相手・対象・話題・比較"],
  冲着: ["相手・対象・話題・比較"],
};

export const CHOICE_COUNT = 4;

// The pinyin scripts/generate-example-pinyin.ts wrote for an example
// sentence of the complement or preposition data.
export function examplePinyinOf(sentence: string): string {
  return Object.hasOwn(EXAMPLE_PINYIN, sentence)
    ? EXAMPLE_PINYIN[sentence]
    : "";
}
export const BLANK = "（　）";

export type PrepositionQuestion = {
  id: string;
  noun: string;
  meaning: string;
  // The phrase with the preposition left out as BLANK.
  prompt: string;
  phrase: string;
  answer: string;
  pinyin: string;
  example: string;
  // Pinyin of the whole example; empty when the sentence has none yet.
  examplePinyin: string;
  translation: string;
  // CHOICE_COUNT prepositions in display order; exactly one is the answer.
  choices: string[];
};

// A random number in [0, 1), as Math.random returns.
export type Random = () => number;

function shuffled<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Every category a preposition is used in.
export function categoriesOf(
  preposition: string,
  usages: readonly PrepositionUsage[] = PREPOSITION_USAGES,
): Set<string> {
  const categories = new Set<string>(ALSO_IN[preposition] ?? []);
  for (const usage of usages)
    if (usage.preposition === preposition) categories.add(usage.category);
  return categories;
}

// Wrong choices come only from prepositions that share no category with the
// answer, so a near-synonym (从 for 自, 按照 for 依照) is never marked wrong.
export function wrongChoicesFor(
  answer: string,
  usages: readonly PrepositionUsage[] = PREPOSITION_USAGES,
): string[] {
  const own = categoriesOf(answer, usages);
  const prepositions = new Set(usages.map((usage) => usage.preposition));
  return [...prepositions].filter(
    (preposition) =>
      ![...categoriesOf(preposition, usages)].some((category) =>
        own.has(category),
      ),
  );
}

export function buildQuestion(
  usage: PrepositionUsage,
  pair: PrepositionUsage["pairs"][number],
  random: Random = Math.random,
  usages: readonly PrepositionUsage[] = PREPOSITION_USAGES,
): PrepositionQuestion {
  const { phrase, at } = pair;
  const answer = usage.preposition;
  const wrong = shuffled(wrongChoicesFor(answer, usages), random);
  return {
    id: usage.id,
    noun: pair.noun,
    meaning: usage.meaning,
    prompt: `${phrase.slice(0, at)}${BLANK}${phrase.slice(at + answer.length)}`,
    phrase,
    answer,
    pinyin: usage.pinyin,
    example: usage.example,
    examplePinyin: examplePinyinOf(usage.example),
    translation: usage.translation,
    choices: shuffled([answer, ...wrong.slice(0, CHOICE_COUNT - 1)], random),
  };
}

// The pairs of a use that pass the HSK filter (all of them without one).
function pairsAt(usage: PrepositionUsage, filter: HskFilter | null) {
  return usage.pairs.filter((pair) =>
    inHskFilter(filter, pair.phrase, usage.example),
  );
}

// `count` questions in random order, each on a different preposition, only
// those that pass the HSK filter when one is given.
export function buildQuiz(
  count: number,
  random: Random = Math.random,
  usages: readonly PrepositionUsage[] = PREPOSITION_USAGES,
  filter: HskFilter | null = null,
): PrepositionQuestion[] {
  const seen = new Set<string>();
  const questions: PrepositionQuestion[] = [];
  for (const usage of shuffled(usages, random)) {
    if (questions.length >= count) break;
    if (seen.has(usage.preposition)) continue;
    const pairs = pairsAt(usage, filter);
    if (pairs.length === 0) continue;
    seen.add(usage.preposition);
    const pair = pairs[Math.floor(random() * pairs.length)];
    questions.push(buildQuestion(usage, pair, random, usages));
  }
  return questions;
}

// How many questions (a use with one of its nouns) there are at each level.
export function countPrepositionQuestionsByLevel(
  basis: HskBasis,
  usages: readonly PrepositionUsage[] = PREPOSITION_USAGES,
): Record<HskLevel, number> {
  const counts: Record<HskLevel, number> = { 4: 0, 5: 0, 6: 0 };
  for (const usage of usages)
    for (const pair of usage.pairs)
      counts[hskLevelOf(basis, pair.phrase, usage.example)]++;
  return counts;
}

// How many different prepositions a quiz of the level can ask, at most.
export function countPrepositionsAt(
  filter: HskFilter | null,
  usages: readonly PrepositionUsage[] = PREPOSITION_USAGES,
): number {
  return new Set(
    usages
      .filter((usage) => pairsAt(usage, filter).length > 0)
      .map((usage) => usage.preposition),
  ).size;
}

// How far the progress bar reaches, 0 to 100.
export function progressPercent(done: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (done / total) * 100));
}
