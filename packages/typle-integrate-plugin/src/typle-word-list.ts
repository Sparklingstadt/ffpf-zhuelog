import type { LearningEntry } from "@ffpf-zhuelog/core/integration";

export type TypleWord = {
  display: string;
  input: string;
  annotation: string;
};

export type TypleWordList = {
  id: string;
  name: string;
  words: TypleWord[];
  records: [];
  createdAt: string;
};

export type TypleExport = {
  version: 1;
  lists: [TypleWordList];
};

const HAN_RUN = /\p{Script=Han}+/gu;
const ONLY_HAN = /^\p{Script=Han}{1,20}$/u;
const QUOTED = /[\u300c\u300e“"']([^\u300d\u300f”"']{1,40})[\u300d\u300f”"']/gu;
const MAX_WORDS = 500;
// ICU's Chinese dictionary splits many common three-character words
// (图书馆 → 图书|馆, 电影院 → 电影|院), so short runs are kept whole.
const MAX_UNSEGMENTED = 3;
// Text this long that the original sentence also contains was moved, not added.
const MIN_MOVED = 2;

function chineseTokens(text: string) {
  const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
  return (text.match(HAN_RUN) ?? []).flatMap((run) =>
    Array.from(run).length <= MAX_UNSEGMENTED
      ? [run]
      : Array.from(segmenter.segment(run))
          .filter((part) => part.isWordLike)
          .map((part) => part.segment),
  );
}

// The longest run of `changed` that `original` also contains. `changed` is at
// most 20 characters, so trying its substrings stays cheap for long notes.
function movedRun(original: string, changed: readonly string[]) {
  for (let length = changed.length; length >= MIN_MOVED; length--) {
    for (let start = 0; start + length <= changed.length; start++) {
      if (original.includes(changed.slice(start, start + length).join("")))
        return { start, length };
    }
  }
  return undefined;
}

// Splits the changed part of the corrected sentence around text that also
// appears in the original, so a reordering keeps only what was really added.
function addedParts(original: string, changed: readonly string[]): string[] {
  const moved = movedRun(original, changed);
  if (!moved) return [changed.join("")];
  return [
    ...addedParts(original, changed.slice(0, moved.start)),
    ...addedParts(original, changed.slice(moved.start + moved.length)),
  ];
}

function termsFromHint(hint: string) {
  const terms = Array.from(hint.matchAll(QUOTED), (match) => match[1])
    .flatMap(chineseTokens)
    .filter((term) => ONLY_HAN.test(term));

  const trimmed = hint.trim();
  if (ONLY_HAN.test(trimmed)) terms.push(trimmed);
  return terms;
}

function correctedTerms(originalText: string, correctedText: string) {
  const original = Array.from(originalText);
  const corrected = Array.from(correctedText);
  let prefix = 0;
  while (
    prefix < original.length &&
    prefix < corrected.length &&
    original[prefix] === corrected[prefix]
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < original.length - prefix &&
    suffix < corrected.length - prefix &&
    original[original.length - suffix - 1] ===
      corrected[corrected.length - suffix - 1]
  ) {
    suffix++;
  }

  const changed = corrected.slice(prefix, corrected.length - suffix);
  if (changed.length > 20) return [];
  return addedParts(
    original.slice(prefix, original.length - suffix).join(""),
    changed,
  )
    .flatMap(chineseTokens)
    .filter((token) => ONLY_HAN.test(token));
}

function annotationFor(entry: LearningEntry, term: string) {
  const matchingHints = entry.hints
    .map((hint) => hint.content.trim())
    .filter((hint) => hint.includes(term));
  const parts = [
    ...matchingHints,
    `例文: ${entry.correctedText}`,
    `拼音: ${entry.pinyin}`,
  ];
  return parts.join(" / ").slice(0, 500);
}

export function extractTypleWords(
  entries: readonly LearningEntry[],
): TypleWord[] {
  const words = new Map<string, TypleWord>();

  for (const entry of entries) {
    const hintTerms = entry.hints.flatMap((hint) =>
      termsFromHint(hint.content),
    );
    // A translation note's original is Japanese, so diffing it against the
    // Chinese translation would add the whole sentence. Hints may also quote
    // Japanese words (kanji-only ones look Chinese), so keep only the terms
    // that actually appear in the translation.
    const terms =
      entry.kind === "translation"
        ? hintTerms.filter((term) => entry.correctedText.includes(term))
        : [
            ...hintTerms,
            ...correctedTerms(entry.originalText, entry.correctedText),
          ];

    for (const term of terms) {
      if (words.has(term)) continue;
      words.set(term, {
        display: term,
        input: term,
        annotation: annotationFor(entry, term),
      });
      if (words.size >= MAX_WORDS) return Array.from(words.values());
    }
  }

  return Array.from(words.values());
}

export function createTypleExport(
  entries: readonly LearningEntry[],
  createdAt = new Date(),
): TypleExport {
  return {
    version: 1,
    lists: [
      {
        id: "ffpf-zhuelog-review",
        name: "学习録から復習",
        words: extractTypleWords(entries),
        records: [],
        createdAt: createdAt.toISOString(),
      },
    ],
  };
}
