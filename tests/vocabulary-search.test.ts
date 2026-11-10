import assert from "node:assert/strict";
import { test } from "node:test";

import { matchesVocabulary } from "../src/presentation/presenters/vocabulary-search";

const renzhen = {
  word: "认真",
  pinyin: "rènzhēn",
  meaning: "まじめに、真剣に",
};
const lv = { word: "绿", pinyin: "lǜ", meaning: "緑" };

test("an empty search matches every word", () => {
  assert.equal(matchesVocabulary(renzhen, ""), true);
  assert.equal(matchesVocabulary(renzhen, "  "), true);
});

test("the word, the pinyin and the meaning are searched", () => {
  assert.equal(matchesVocabulary(renzhen, "认"), true);
  assert.equal(matchesVocabulary(renzhen, "rènzhēn"), true);
  assert.equal(matchesVocabulary(renzhen, "真剣"), true);
  assert.equal(matchesVocabulary(renzhen, "学校"), false);
});

test("pinyin is found without tone marks, spaces or capitals", () => {
  assert.equal(matchesVocabulary(renzhen, "renzhen"), true);
  assert.equal(matchesVocabulary(renzhen, "Ren Zhen"), true);
  assert.equal(matchesVocabulary(lv, "lv"), true);
  assert.equal(matchesVocabulary(lv, "lu:"), true);
});
