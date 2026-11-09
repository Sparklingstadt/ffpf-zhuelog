import assert from "node:assert/strict";
import { test } from "node:test";

import { examplePinyin } from "../scripts/lib/example-pinyin";
import { ASPECT_PARTICLE_USAGES } from "../src/domain/practice/aspect-particle-data";
import { aspectParticleQuestion } from "../src/domain/practice/aspect-particle-quiz";
import { COMPLEMENT_USAGES } from "../src/domain/practice/complement-data";
import { complementQuestion } from "../src/domain/practice/complement-quiz";
import { COMPLEMENT_VERB_USAGES } from "../src/domain/practice/complement-verb-data";
import { complementVerbQuestion } from "../src/domain/practice/complement-verb-quiz";
import { EXAMPLE_PINYIN } from "../src/domain/practice/example-pinyin";
import { MEASURE_WORD_USAGES } from "../src/domain/practice/measure-word-data";
import { measureWordQuestion } from "../src/domain/practice/measure-word-quiz";
import { PREPOSITION_USAGES } from "../src/domain/practice/preposition-data";
import { buildQuestion } from "../src/domain/practice/preposition-quiz";

// Every question the complement, measure-word, 了・过・着 and preposition
// practices can ask.
const questions = [
  ...COMPLEMENT_USAGES.map((usage) => complementQuestion(usage)),
  ...COMPLEMENT_VERB_USAGES.flatMap((usage) =>
    usage.pairs.map((pair) => complementVerbQuestion(usage, pair)),
  ),
  ...PREPOSITION_USAGES.flatMap((usage) =>
    usage.pairs.map((pair) => buildQuestion(usage, pair)),
  ),
  ...MEASURE_WORD_USAGES.map((usage) => measureWordQuestion(usage)),
  ...ASPECT_PARTICLE_USAGES.map(aspectParticleQuestion),
];

test("every practice example has its pinyin", () => {
  const missing = questions
    .filter((question) => question.examplePinyin === "")
    .map((question) => question.example);
  assert.deepEqual(
    missing,
    [],
    "run pnpm exec tsx scripts/generate-example-pinyin.ts",
  );
});

test("example-pinyin.ts is what the generator writes now", () => {
  const sentences = new Set(questions.map((question) => question.example));
  assert.deepEqual(
    Object.keys(EXAMPLE_PINYIN).filter((sentence) => !sentences.has(sentence)),
    [],
    "sentences no question shows any more",
  );
  for (const [sentence, pinyin] of Object.entries(EXAMPLE_PINYIN))
    assert.equal(pinyin, examplePinyin(sentence), sentence);
});

test("pinyin reads the structural 得, the suffix 子 and erhua 儿", () => {
  assert.equal(examplePinyin("他跑得很快。"), "Tā pǎo de hěn kuài.");
  assert.equal(
    examplePinyin("这个小箱子很轻。"),
    "Zhè ge xiǎo xiāng zi hěn qīng.",
  );
  assert.equal(
    examplePinyin("鸟儿傍晚飞回了树林。"),
    "Niǎor bàng wǎn fēi huí le shù lín.",
  );
});

test("pinyin takes the readings of READING_FIXES", () => {
  assert.equal(examplePinyin("我昨晚睡不着。"), "Wǒ zuó wǎn shuì bù zháo.");
  assert.equal(examplePinyin("她高兴得不得了。"), "Tā gāo xìng de bù dé liǎo.");
  assert.equal(
    examplePinyin("我的自行车骑坏了，得去修一修。"),
    "Wǒ de zì xíng chē qí huài le, děi qù xiū yi xiū.",
  );
});

test("pinyin turns the punctuation into its Latin form", () => {
  assert.equal(
    examplePinyin("他竖起大拇指说：“真棒！”"),
    "Tā shù qǐ dà mǔ zhǐ shuō: “zhēn bàng!”",
  );
  assert.equal(examplePinyin("你听得懂吗？"), "Nǐ tīng de dǒng ma?");
});
