import { COMPLEMENT_VERB_USAGES } from "./complement-verb-data";
import {
  BLANK,
  CHOICE_COUNT,
  examplePinyinOf,
  type PrepositionQuestion,
  type Random,
} from "./preposition-quiz";

// The "動詞から選ぶ" (verb) mode of complement practice: the questions are
// built like the preposition ones, from a verb and a meaning, with the
// complement blanked out of a short phrase and the wrong choices picked by
// rule rather than written by hand.

// One use of a complement, from a row of the complement CSV.
export type ComplementVerbUsage = {
  id: string;
  complement: string;
  pinyin: string;
  meaning: string;
  category: string;
  // Verbs this use takes, each in a phrase; `at` is where the complement
  // starts in the phrase (right after the verb).
  pairs: readonly { verb: string; phrase: string; at: number }[];
  example: string;
  translation: string;
};

// Question ids of this mode: "verb:<usage id>:<verb>", so a review item
// names the exact verb asked, as a preposition item names its noun.
const ID_PREFIX = "verb:";

export function verbQuestionId(usageId: string, verb: string) {
  return `${ID_PREFIX}${usageId}:${verb}`;
}

export function isVerbQuestionId(id: string) {
  return id.startsWith(ID_PREFIX);
}

function shuffled<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Every category a complement is used in.
export function categoriesOfComplement(
  complement: string,
  usages: readonly ComplementVerbUsage[] = COMPLEMENT_VERB_USAGES,
): Set<string> {
  const categories = new Set<string>();
  for (const usage of usages)
    if (usage.complement === complement) categories.add(usage.category);
  return categories;
}

// Wrong choices for `answer` asked with `verb`: complements that share no
// category with the answer, never pair with the verb in the data (看完 is
// not wrong for 看懂), and neither contain nor sit inside the answer (得懂
// for 懂, 下 for 下来).
export function wrongComplementsFor(
  answer: string,
  verb: string,
  usages: readonly ComplementVerbUsage[] = COMPLEMENT_VERB_USAGES,
): string[] {
  const own = categoriesOfComplement(answer, usages);
  const withVerb = new Set(
    usages
      .filter((usage) => usage.pairs.some((pair) => pair.verb === verb))
      .map((usage) => usage.complement),
  );
  const complements = new Set(usages.map((usage) => usage.complement));
  return [...complements].filter(
    (complement) =>
      !withVerb.has(complement) &&
      !complement.includes(answer) &&
      !answer.includes(complement) &&
      ![...categoriesOfComplement(complement, usages)].some((category) =>
        own.has(category),
      ),
  );
}

// A question of the verb mode, in the shape every choice practice shows:
// the verb stands where the preposition practice shows its noun.
export function complementVerbQuestion(
  usage: ComplementVerbUsage,
  pair: ComplementVerbUsage["pairs"][number],
  random: Random = Math.random,
  usages: readonly ComplementVerbUsage[] = COMPLEMENT_VERB_USAGES,
): PrepositionQuestion {
  const { phrase, at } = pair;
  const answer = usage.complement;
  const wrong = shuffled(
    wrongComplementsFor(answer, pair.verb, usages),
    random,
  );
  return {
    id: verbQuestionId(usage.id, pair.verb),
    noun: pair.verb,
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

// The question a "verb:<usage id>:<verb>" id names, with fresh choices, or
// null when the data no longer has that use or that verb.
export function complementVerbQuestionById(
  id: string,
  random: Random = Math.random,
  usages: readonly ComplementVerbUsage[] = COMPLEMENT_VERB_USAGES,
): PrepositionQuestion | null {
  if (!isVerbQuestionId(id)) return null;
  const rest = id.slice(ID_PREFIX.length);
  const at = rest.indexOf(":");
  if (at <= 0) return null;
  const usageId = rest.slice(0, at);
  const verb = rest.slice(at + 1);
  const usage = usages.find((u) => u.id === usageId);
  const pair = usage?.pairs.find((p) => p.verb === verb);
  return usage && pair
    ? complementVerbQuestion(usage, pair, random, usages)
    : null;
}

export function countComplementVerbQuestions(
  usages: readonly ComplementVerbUsage[] = COMPLEMENT_VERB_USAGES,
) {
  return usages.reduce((sum, usage) => sum + usage.pairs.length, 0);
}

// `count` questions in random order, each on a different complement.
export function buildComplementVerbQuiz(
  count: number,
  random: Random = Math.random,
  usages: readonly ComplementVerbUsage[] = COMPLEMENT_VERB_USAGES,
): PrepositionQuestion[] {
  const seen = new Set<string>();
  const questions: PrepositionQuestion[] = [];
  for (const usage of shuffled(usages, random)) {
    if (questions.length >= count) break;
    if (seen.has(usage.complement)) continue;
    seen.add(usage.complement);
    const pair = usage.pairs[Math.floor(random() * usage.pairs.length)];
    questions.push(complementVerbQuestion(usage, pair, random, usages));
  }
  return questions;
}
