// A round of practice: `count` questions, each a phrase with one word
// (a preposition, a complement) blanked out and four words to pick from. The
// same code serves every kind; the kind only brings its usages.

export type PracticeKind = "preposition" | "complement";

// One use of a word, from a row of the kind's CSV.
export type PracticeUsage = {
  id: string;
  // The word to pick: the preposition, or the complement.
  word: string;
  pinyin: string;
  meaning: string;
  category: string;
  // Headwords (nouns, verbs) this use takes, each in a phrase; `at` is where
  // the word starts in the phrase.
  pairs: readonly { headword: string; phrase: string; at: number }[];
  example: string;
  translation: string;
};

export type PracticeQuestion = {
  id: string;
  headword: string;
  meaning: string;
  // The phrase with the word left out as BLANK.
  prompt: string;
  phrase: string;
  answer: string;
  pinyin: string;
  example: string;
  translation: string;
  // CHOICE_COUNT words in display order; exactly one is the answer.
  choices: string[];
};

// A random number in [0, 1), as Math.random returns.
export type Random = () => number;

// Where a kind's questions come from. `alsoIn` adds categories a word has
// that none of its rows is in (the prepositions need it).
export type QuizSource = {
  usages: readonly PracticeUsage[];
  alsoIn?: Record<string, readonly string[]>;
};

export const CHOICE_COUNT = 4;
export const BLANK = "（　）";

function shuffled<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Every category a word is used in.
export function categoriesOf(word: string, source: QuizSource): Set<string> {
  const categories = new Set<string>(source.alsoIn?.[word] ?? []);
  for (const usage of source.usages)
    if (usage.word === word) categories.add(usage.category);
  return categories;
}

// Wrong choices for `answer` asked with `headword`: words that share no
// category with the answer (so a near-synonym such as 从 for 自 is never
// marked wrong), never pair with the headword in the data (看完 is not wrong
// for 看懂), and neither contain nor sit inside the answer (得懂 for 懂,
// 下 for 下来).
export function wrongChoicesFor(
  answer: string,
  headword: string,
  source: QuizSource,
): string[] {
  const own = categoriesOf(answer, source);
  const withHeadword = new Set(
    source.usages
      .filter((usage) => usage.pairs.some((pair) => pair.headword === headword))
      .map((usage) => usage.word),
  );
  const words = new Set(source.usages.map((usage) => usage.word));
  return [...words].filter(
    (word) =>
      !withHeadword.has(word) &&
      !word.includes(answer) &&
      !answer.includes(word) &&
      ![...categoriesOf(word, source)].some((category) => own.has(category)),
  );
}

export function buildQuestion(
  source: QuizSource,
  usage: PracticeUsage,
  pair: PracticeUsage["pairs"][number],
  random: Random = Math.random,
): PracticeQuestion {
  const { phrase, at } = pair;
  const answer = usage.word;
  const wrong = shuffled(
    wrongChoicesFor(answer, pair.headword, source),
    random,
  );
  return {
    id: usage.id,
    headword: pair.headword,
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

// `count` questions in random order, each on a different word.
export function buildQuiz(
  source: QuizSource,
  count: number,
  random: Random = Math.random,
): PracticeQuestion[] {
  const seen = new Set<string>();
  const questions: PracticeQuestion[] = [];
  for (const usage of shuffled(source.usages, random)) {
    if (questions.length >= count) break;
    if (seen.has(usage.word)) continue;
    seen.add(usage.word);
    const pair = usage.pairs[Math.floor(random() * usage.pairs.length)];
    questions.push(buildQuestion(source, usage, pair, random));
  }
  return questions;
}

// How far the progress bar reaches, 0 to 100.
export function progressPercent(done: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (done / total) * 100));
}
