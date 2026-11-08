import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hskVocabulary,
  officialHardWords,
  parseCsv,
  practiceTexts,
  segment,
} from "../scripts/lib/hsk-words-official";
import { HSK_OFFICIAL_HARD_WORDS } from "../src/domain/practice/hsk-words-official";

const vocabulary = hskVocabulary();
const texts = practiceTexts();

test("hsk-words-official.ts is what the generator writes now", () => {
  const expected = officialHardWords(vocabulary, texts);
  assert.deepEqual(
    Object.entries(HSK_OFFICIAL_HARD_WORDS),
    Object.entries(expected),
    "run node --import tsx scripts/generate-hsk-words.ts",
  );
});

test("every entry is of level 5, 6 or 7–9 and found in a practice text", () => {
  const found = new Set(
    texts.flatMap((text) =>
      segment(text, vocabulary).flatMap((token) =>
        token.level === undefined ? [] : [token.word],
      ),
    ),
  );
  for (const [word, level] of Object.entries(HSK_OFFICIAL_HARD_WORDS)) {
    assert.ok([5, 6, 7].includes(level), `${word}: ${level}`);
    assert.equal(vocabulary.levels.get(word), level, word);
    assert.ok(
      texts.some((text) => text.includes(word)),
      `${word} is in no text`,
    );
    assert.ok(found.has(word), `segmentation never finds ${word}`);
  }
});

test("the CSV parser reads quoted fields", () => {
  assert.deepEqual(parseCsv('a,"b,""c"""\n"d\ne",f\n'), [
    ["a", 'b,"c"'],
    ["d\ne", "f"],
  ]);
});

test("the vocabulary reads forms, variants and the lowest level", () => {
  const level = (word: string) => vocabulary.levels.get(word);
  // 爸爸|爸, and the notes of the Variants column.
  assert.equal(level("爸"), 1);
  assert.equal(level("有些"), 1);
  assert.equal(level("有一些"), 1);
  assert.equal(level("称"), 2);
  assert.equal(level("称1"), undefined);
  // 看 is at 1 and 6; 7-9 is 7.
  assert.equal(level("看"), 1);
  assert.equal(level("座右铭"), 7);
  // The erhua 儿 may be left out, a syllable 儿 may not.
  assert.equal(level("玩"), 1);
  assert.equal(level("婴儿"), 7);
  assert.equal(level("婴"), undefined);
});

test("segmentation takes the longest word and keeps unknown runs", () => {
  assert.deepEqual(segment("我已经看完这本书了。", vocabulary), [
    { word: "我", level: 1 },
    { word: "已经", level: 2 },
    { word: "看", level: 1 },
    { word: "完", level: 2 },
    { word: "这", level: 1 },
    { word: "本", level: 1 },
    { word: "书", level: 1 },
    { word: "了", level: 1 },
  ]);
  assert.deepEqual(
    segment("他把帽子摘了下来，向大家鞠了一躬。", vocabulary).filter(
      (token) => token.level === undefined,
    ),
    [{ unknown: "鞠" }, { unknown: "躬" }],
  );
});
