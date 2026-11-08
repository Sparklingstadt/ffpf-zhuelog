import { HSK_EASY_WORDS, HSK_HARD_WORDS } from "./hsk-words";

// The HSK 3.0 levels the preposition and complement practices are split
// into. 4 also takes the questions of levels 1-3, and 6 those of 7-9.
export const HSK_LEVELS = [4, 5, 6] as const;
export type HskLevel = (typeof HSK_LEVELS)[number];

export const HSK_LEVEL_LABELS: Record<HskLevel, string> = {
  4: "HSK 4級まで",
  5: "HSK 5級",
  6: "HSK 6級以上",
};

// Reads ?hsk= of a practice page; anything else is no level (every question).
export function parseHskLevel(value: unknown): HskLevel | null {
  const first = Array.isArray(value) ? value[0] : value;
  const level = Number(first);
  return (HSK_LEVELS as readonly number[]).includes(level)
    ? (level as HskLevel)
    : null;
}

const MULTI_CHAR_WORDS = Object.keys(HSK_HARD_WORDS)
  .filter((word) => word.length > 1)
  // Longest first, so a word is masked before the shorter ones inside it.
  .sort((a, b) => b.length - a.length);
const ONE_CHAR_WORDS = Object.keys(HSK_HARD_WORDS).filter(
  (word) => word.length === 1,
);
const MASKS = [...MULTI_CHAR_WORDS, ...HSK_EASY_WORDS].sort(
  (a, b) => b.length - a.length,
);

// The words of HSK_HARD_WORDS found in the texts, hardest first. Words of
// two or more characters are found anywhere; a one-character word only where
// it is not part of a listed word (hard or easy), so 已经 is not 经.
export function hardWordsIn(...texts: string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const word of MULTI_CHAR_WORDS)
      if (text.includes(word)) found.add(word);
    let masked = text;
    for (const word of MASKS)
      masked = masked.replaceAll(word, "□".repeat(word.length));
    for (const word of ONE_CHAR_WORDS)
      if (masked.includes(word)) found.add(word);
  }
  return [...found].sort((a, b) => HSK_HARD_WORDS[b] - HSK_HARD_WORDS[a]);
}

// A question's level: the HSK level of its hardest word, among the phrase it
// asks about and its example sentence. Words of levels 1-4 are not listed,
// so a question without a listed word is level 4.
export function hskLevelOf(...texts: string[]): HskLevel {
  const hardest = Math.max(
    4,
    ...hardWordsIn(...texts).map((word) => HSK_HARD_WORDS[word]),
  );
  return hardest >= 6 ? 6 : (hardest as 4 | 5);
}
