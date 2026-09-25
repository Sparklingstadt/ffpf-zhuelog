import type { LearningEntry } from "@/domain/learning/entities/learning-entry";

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

const HAN = /\p{Script=Han}/u;
const ONLY_HAN = /^\p{Script=Han}{1,20}$/u;
const QUOTED = /[\u300c\u300e“"']([^\u300d\u300f”"']{1,40})[\u300d\u300f”"']/gu;
const MAX_WORDS = 500;

function chineseTokens(text: string) {
  const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
  return Array.from(segmenter.segment(text))
    .filter((part) => part.isWordLike && HAN.test(part.segment))
    .map((part) => part.segment.trim())
    .filter(Boolean);
}

function termsFromHint(hint: string) {
  const terms = Array.from(hint.matchAll(QUOTED), (match) => match[1].trim())
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

  const changed = corrected
    .slice(prefix, corrected.length - suffix)
    .join("")
    .trim();
  if (!changed || Array.from(changed).length > 20) return [];
  return chineseTokens(changed).filter((token) => ONLY_HAN.test(token));
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

export function extractTypleWords(entries: LearningEntry[]): TypleWord[] {
  const words = new Map<string, TypleWord>();

  for (const entry of entries) {
    const terms = [
      ...entry.hints.flatMap((hint) => termsFromHint(hint.content)),
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
  entries: LearningEntry[],
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
