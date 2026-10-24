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
    translation: usage.translation,
    choices: shuffled([answer, ...wrong.slice(0, CHOICE_COUNT - 1)], random),
  };
}

// `count` questions in random order, each on a different preposition.
export function buildQuiz(
  count: number,
  random: Random = Math.random,
  usages: readonly PrepositionUsage[] = PREPOSITION_USAGES,
): PrepositionQuestion[] {
  const seen = new Set<string>();
  const questions: PrepositionQuestion[] = [];
  for (const usage of shuffled(usages, random)) {
    if (questions.length >= count) break;
    if (seen.has(usage.preposition)) continue;
    seen.add(usage.preposition);
    const pair = usage.pairs[Math.floor(random() * usage.pairs.length)];
    questions.push(buildQuestion(usage, pair, random, usages));
  }
  return questions;
}

// How far the progress bar reaches, 0 to 100.
export function progressPercent(done: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (done / total) * 100));
}
