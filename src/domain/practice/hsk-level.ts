import { HSK_EASY_WORDS, HSK_HARD_WORDS } from "./hsk-words";
import { HSK_OFFICIAL_TEXT_LEVELS } from "./hsk-words-official";

// The HSK 3.0 levels the preposition and complement practices are split
// into. 4 also takes the questions of levels 1-3, and 6 those of 7-9.
export const HSK_LEVELS = [4, 5, 6] as const;
export type HskLevel = (typeof HSK_LEVELS)[number];

export const HSK_LEVEL_LABELS: Record<HskLevel, string> = {
  4: "HSK 4級まで",
  5: "HSK 5級",
  6: "HSK 6級以上",
};

// How a question's level is decided. "curated" searches the texts for the
// hand-made list of hard words (hsk-words.ts); "official" looks the texts up
// in the levels generated from the official HSK 3.0 word list
// (hsk-words-official.ts, by scripts/generate-hsk-words.ts).
export const HSK_BASES = ["curated", "official"] as const;
export type HskBasis = (typeof HSK_BASES)[number];

export const HSK_BASIS_LABELS: Record<HskBasis, string> = {
  curated: "手作りの表",
  official: "公式の語彙表",
};

export const DEFAULT_HSK_BASIS: HskBasis = "curated";

export function parseHskBasis(value: unknown): HskBasis {
  return value === "official" ? "official" : DEFAULT_HSK_BASIS;
}

// The questions a quiz is narrowed to: one level, decided one way.
export type HskFilter = { level: HskLevel; basis: HskBasis };

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

// The words of HSK_HARD_WORDS (the hand-made list) found in the texts,
// hardest first. Words of
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

// A question's level, decided by `basis`, from the phrase it asks about and
// its example sentence: the HSK level of the hardest word. Questions of
// levels 1-3 count as 4 and those of 7-9 as 6.
export function hskLevelOf(basis: HskBasis, ...texts: string[]): HskLevel {
  const hardest =
    basis === "official"
      ? Math.max(4, ...texts.map((text) => HSK_OFFICIAL_TEXT_LEVELS[text] ?? 4))
      : Math.max(
          4,
          ...hardWordsIn(...texts).map((word) => HSK_HARD_WORDS[word]),
        );
  return hardest >= 6 ? 6 : (hardest as 4 | 5);
}

// Whether a question with these texts passes the filter (null passes all).
export function inHskFilter(
  filter: HskFilter | null,
  ...texts: string[]
): boolean {
  return filter === null || hskLevelOf(filter.basis, ...texts) === filter.level;
}
