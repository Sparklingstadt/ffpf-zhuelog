// HSK 3.0 levels from the official word list (data/hsk30.csv), and the
// segmentation that finds which of its words each practice text uses.
// Used by scripts/generate-hsk-words.ts and tests/hsk-words-official.test.ts.
import { readFileSync } from "node:fs";

import { COMPLEMENT_USAGES } from "../../src/domain/practice/complement-data";
import { COMPLEMENT_VERB_USAGES } from "../../src/domain/practice/complement-verb-data";
import { PREPOSITION_USAGES } from "../../src/domain/practice/preposition-data";

// 1–6, and 7 for the "7-9" band, which the standard does not split.
export type HskLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type HardLevel = 5 | 6 | 7;

export type HskVocabulary = {
  // Lowest level of each written form.
  levels: ReadonlyMap<string, HskLevel>;
  // Length in characters of the longest form, where matching starts.
  longest: number;
};

// A run of a text: an HSK word, or Chinese characters no word starts with.
export type Token =
  { word: string; level: HskLevel } | { unknown: string; level?: undefined };

const csvUrl = new URL("../../data/hsk30.csv", import.meta.url);
const han = /^\p{Script=Han}+$/u;

// Rows of an RFC 4180 CSV: quoted fields may hold commas, "" and newlines.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') field += text[++i];
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  return rows;
}

function levelOf(value: string, id: string): HskLevel {
  if (value === "7-9") return 7;
  const level = Number(value);
  if (Number.isInteger(level) && level >= 1 && level <= 6)
    return level as HskLevel;
  throw new Error(`${id}: unknown level ${JSON.stringify(value)}`);
}

// Written forms of a row. Simplified holds "爸爸|爸" for two forms, and for
// 34 rows a note the Variants column spells out: 有（一）些 is 有些 and
// 有一些, 第（第二） is 第 with 第二 as its example, 称1 is 称. A word the
// list writes with the erhua 儿 (玩儿 wánr, not 女儿 nǚ'ér) is also matched
// without it, as the practice texts write 玩 and 小孩.
function formsOf(
  simplified: string,
  pinyin: string,
  variants: string,
  id: string,
): string[] {
  const forms = new Set(simplified.split("|").filter((form) => han.test(form)));
  if (variants !== "") {
    const parsed: unknown = JSON.parse(variants);
    if (!Array.isArray(parsed))
      throw new Error(`${id}: Variants is not a list`);
    for (const variant of parsed) {
      const form: unknown = variant?.Simplified;
      if (typeof form === "string" && han.test(form)) forms.add(form);
    }
  }
  if (forms.size === 0) throw new Error(`${id}: no word in ${simplified}`);
  if (/[^ée]r$/.test(pinyin))
    for (const form of [...forms])
      if (form.length > 1 && form.endsWith("儿")) forms.add(form.slice(0, -1));
  return [...forms];
}

// Reads hsk30.csv (https://github.com/ivankra/hsk30). A form listed at
// several levels, as 看 at 1 and 6, takes the lowest.
export function hskVocabulary(
  csv: string = readFileSync(csvUrl, "utf8"),
): HskVocabulary {
  const [header, ...rows] = parseCsv(csv);
  const column = (name: string) => {
    const at = header.indexOf(name);
    if (at < 0) throw new Error(`hsk30.csv has no ${name} column`);
    return at;
  };
  const [id, simplified, pinyin, level, variants] = [
    "ID",
    "Simplified",
    "Pinyin",
    "Level",
    "Variants",
  ].map(column);
  const levels = new Map<string, HskLevel>();
  for (const row of rows) {
    if (row.length !== header.length)
      throw new Error(`${row[id]}: ${row.length} columns`);
    const rowLevel = levelOf(row[level], row[id]);
    const forms = formsOf(row[simplified], row[pinyin], row[variants], row[id]);
    for (const form of forms)
      levels.set(form, Math.min(levels.get(form) ?? 7, rowLevel) as HskLevel);
  }
  const longest = Math.max(...[...levels.keys()].map((w) => [...w].length));
  return { levels, longest };
}

// Forward maximum matching: from each position the longest HSK word that
// starts there. Punctuation is skipped; Chinese characters no word starts
// with are kept together as one unknown token.
export function segment(text: string, vocabulary: HskVocabulary): Token[] {
  const chars = [...text];
  const tokens: Token[] = [];
  let unknown = "";
  const flush = () => {
    if (unknown !== "") tokens.push({ unknown });
    unknown = "";
  };
  for (let i = 0; i < chars.length;) {
    if (!han.test(chars[i])) {
      flush();
      i++;
      continue;
    }
    let length = Math.min(vocabulary.longest, chars.length - i);
    for (; length > 0; length--) {
      const word = chars.slice(i, i + length).join("");
      const level = vocabulary.levels.get(word);
      if (level === undefined) continue;
      flush();
      tokens.push({ word, level });
      break;
    }
    if (length === 0) unknown += chars[i++];
    else i += length;
  }
  flush();
  return tokens;
}

// One question of the preposition or complement practice, and the texts it
// shows: the phrase and the example sentence, or for a hand-written
// complement question its prompt with the answer in the blank.
export type PracticeQuestion = {
  practice: "preposition" | "complement";
  // The complement mode; "verb" for COMPLEMENT_VERB_USAGES.
  mode?: string;
  id: string;
  texts: readonly string[];
};

export function practiceQuestions(): PracticeQuestion[] {
  return [
    ...PREPOSITION_USAGES.flatMap((usage) =>
      usage.pairs.map((pair) => ({
        practice: "preposition" as const,
        id: `${usage.id}:${pair.noun}`,
        texts: [pair.phrase, usage.example],
      })),
    ),
    ...COMPLEMENT_USAGES.map((usage) => ({
      practice: "complement" as const,
      mode: usage.mode,
      id: usage.id,
      texts: [usage.prompt.replace("（　）", usage.answer)],
    })),
    ...COMPLEMENT_VERB_USAGES.flatMap((usage) =>
      usage.pairs.map((pair) => ({
        practice: "complement" as const,
        mode: "verb",
        id: `${usage.id}:${pair.verb}`,
        texts: [pair.phrase, usage.example],
      })),
    ),
  ];
}

// Every text the practices show, once each, in code point order.
export function practiceTexts(): string[] {
  return [
    ...new Set(practiceQuestions().flatMap((question) => question.texts)),
  ].sort();
}

// The words of level 5 and above that segmentation finds in the texts, by
// level and then in code point order.
export function officialHardWords(
  vocabulary: HskVocabulary = hskVocabulary(),
  texts: readonly string[] = practiceTexts(),
): Record<string, HardLevel> {
  const found = new Map<string, HardLevel>();
  for (const text of texts)
    for (const token of segment(text, vocabulary))
      if (token.level !== undefined && token.level >= 5)
        found.set(token.word, token.level as HardLevel);
  return Object.fromEntries(
    [...found].sort(
      ([a, levelA], [b, levelB]) =>
        levelA - levelB || (a < b ? -1 : a > b ? 1 : 0),
    ),
  );
}
