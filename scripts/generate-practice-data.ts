// Turns a practice CSV in data/ into its questions file in
// src/domain/practice/. Usage:
//   pnpm exec tsx scripts/generate-practice-data.ts <preposition|complement> <csv>
//
// A row becomes one question per headword (noun, verb) that its 組み合わせ例
// shows next to the word. The prepositions use only rows of a single word
// (区分 介詞・介詞的用法); frames such as 在…上 have no one word to pick.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { format, resolveConfig } from "prettier";

import {
  CHOICE_COUNT,
  type PracticeKind,
  type PracticeUsage,
  wrongChoicesFor,
} from "../src/domain/practice/practice-quiz";
import { PREPOSITION_ALSO_IN } from "../src/domain/practice/preposition-also-in";

type KindSpec = {
  // The 区分 of the rows to use.
  rowKind: string;
  wordColumn: string;
  headwordsColumn: string;
  // The categories the practice tells apart; a row in any other fails.
  categories: readonly string[];
  // Rows whose 意味分類 is replaced, by ID.
  moved: Record<string, string>;
  // Categories a word has beyond its rows, for the wrong-choice check.
  alsoIn: Record<string, readonly string[]>;
  // Which side of the headword the word sits on in a phrase: a preposition
  // comes before its noun (在学校), a complement after its verb (看懂).
  wordSide: "before" | "after";
  constName: string;
  output: URL;
};

const KINDS: Record<PracticeKind, KindSpec> = {
  preposition: {
    rowKind: "介詞・介詞的用法",
    wordColumn: "介詞・表現（簡体字）",
    headwordsColumn: "名詞・句の例（中国語）",
    categories: [
      "場所・時間・起点",
      "相手・対象・話題・比較",
      "手段・道具・根拠・基準",
      "原因・条件・除外・資格",
      "処置・受け身・担当者",
    ],
    // 補足の時間・対象・基準表現 rows mean the same as rows in the five
    // categories, so each goes where it belongs.
    moved: {
      P197: "場所・時間・起点", // 直到
      P198: "場所・時間・起点", // 直至
      P199: "相手・対象・話題・比較", // 相对于
      P200: "手段・道具・根拠・基準", // 依着
      P201: "相手・対象・話題・比較", // 于 〜に対して
      P202: "相手・対象・話題・比較", // 于 〜より
    },
    alsoIn: PREPOSITION_ALSO_IN,
    wordSide: "before",
    constName: "PREPOSITION_USAGES",
    output: new URL(
      "../src/domain/practice/preposition-data.ts",
      import.meta.url,
    ),
  },
  complement: {
    rowKind: "補語",
    wordColumn: "補語（簡体字）",
    headwordsColumn: "動詞の例（中国語）",
    categories: [
      "結果補語",
      "方向補語（単純）",
      "方向補語（複合）",
      "方向補語（派生）",
      "可能補語",
      "程度・様態補語",
    ],
    moved: {},
    alsoIn: {},
    wordSide: "after",
    constName: "COMPLEMENT_USAGES",
    output: new URL(
      "../src/domain/practice/complement-data.ts",
      import.meta.url,
    ),
  },
};

// RFC 4180: quoted fields may hold commas, quotes ("") and line breaks.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

const list = (cell: string) =>
  cell
    .split("；")
    .map((part) => part.trim())
    .filter(Boolean);

// Where the word sits in the phrase, outside the headword.
function wordAt(phrase: string, word: string, headword: string) {
  const headwordAt = phrase.indexOf(headword);
  for (
    let at = phrase.indexOf(word);
    at !== -1;
    at = phrase.indexOf(word, at + 1)
  ) {
    const end = at + word.length;
    if (end <= headwordAt || at >= headwordAt + headword.length) return at;
  }
  return -1;
}

const [kindArg, path] = process.argv.slice(2);
if (!(kindArg in KINDS) || !path)
  throw new Error(
    "usage: generate-practice-data.ts <preposition|complement> <csv>",
  );
const kind = KINDS[kindArg as PracticeKind];
const [header, ...records] = parseCsv(
  readFileSync(path, "utf8").replace(/^﻿/, ""),
);
const column = (name: string) => {
  const index = header.indexOf(name);
  if (index === -1) throw new Error(`no column ${name}`);
  return index;
};
const c = {
  id: column("ID"),
  kind: column("区分"),
  category: column("意味分類"),
  word: column(kind.wordColumn),
  pinyin: column("ピンイン（見出し）"),
  meaning: column("意味（日本語）"),
  headwords: column(kind.headwordsColumn),
  phrases: column("組み合わせ例（中国語）"),
  example: column("例文（中国語・オリジナル）"),
  translation: column("例文の和訳"),
};

const usages: PracticeUsage[] = records
  .filter((record) => record[c.kind] === kind.rowKind)
  .map((record) => {
    const id = record[c.id];
    const word = record[c.word];
    const category = kind.moved[id] ?? record[c.category];
    if (!kind.categories.includes(category))
      throw new Error(`${id}: unknown category ${category}`);
    const phrases = list(record[c.phrases]);
    // The phrase of a headword is the first that holds it on the kind's side
    // of the word (答对问题 for 答, not 猜对答案), or failing that the first
    // that holds it at all.
    const pairs = list(record[c.headwords]).flatMap((headword) => {
      const found = phrases.flatMap((phrase) => {
        const at = wordAt(phrase, word, headword);
        return phrase.includes(headword) && at !== -1
          ? [{ headword, phrase, at }]
          : [];
      });
      const adjacent = found.find(({ phrase, at }) => {
        const headwordAt = phrase.indexOf(headword);
        return kind.wordSide === "after"
          ? at === headwordAt + headword.length
          : at + word.length === headwordAt;
      });
      return adjacent ? [adjacent] : found.slice(0, 1);
    });
    return {
      id,
      word,
      pinyin: record[c.pinyin],
      meaning: record[c.meaning],
      category,
      pairs,
      example: record[c.example],
      translation: record[c.translation],
    };
  })
  .filter((usage) => usage.pairs.length > 0);

// Every question must have its three wrong choices; a row that cannot is a
// gap in the CSV (too few words outside its category), not a runtime case.
const source = { usages, alsoIn: kind.alsoIn };
for (const usage of usages)
  for (const pair of usage.pairs) {
    const wrong = wrongChoicesFor(usage.word, pair.headword, source).length;
    if (wrong < CHOICE_COUNT - 1)
      throw new Error(
        `${usage.id}: only ${wrong} wrong choices for ${pair.headword}`,
      );
  }

// Formatted as the pre-commit hook would, so regenerating the same CSV
// leaves no diff.
const outputPath = fileURLToPath(kind.output);
const csvName = path.split("/").pop();
const text = `// Generated by scripts/generate-practice-data.ts from
// ${csvName}. Do not edit by hand.
import type { PracticeUsage } from "./practice-quiz";

export const ${kind.constName}: readonly PracticeUsage[] = ${JSON.stringify(usages, null, 2)};
`;
// No top-level await: tsx runs this package's scripts as CommonJS.
resolveConfig(outputPath)
  .then((config) => format(text, { ...config, filepath: outputPath }))
  .then((formatted) => {
    writeFileSync(outputPath, formatted);
    console.log(
      `${usages.length} usages, ${usages.reduce((sum, usage) => sum + usage.pairs.length, 0)} questions`,
    );
  });
