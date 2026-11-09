import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COMPLEMENT_ROUND_MODES,
  roundModeLabel,
} from "../src/domain/practice/complement-record";
import { MEASURE_WORD_USAGES } from "../src/domain/practice/measure-word-data";
import {
  buildMeasureWordQuiz,
  isMeasureWordQuestionId,
  measureWordQuestion,
} from "../src/domain/practice/measure-word-quiz";
import { BLANK } from "../src/domain/practice/preposition-quiz";
import {
  reviewChoice,
  reviewQuestion,
} from "../src/domain/practice/review-question";

// A seeded random, so the tests do not depend on Math.random.
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

test("every measure-word question is well formed", () => {
  const ids = new Set<string>();
  for (const usage of MEASURE_WORD_USAGES) {
    assert.match(usage.id, /^measure-\d{2}$/);
    assert.ok(!ids.has(usage.id), `duplicate id ${usage.id}`);
    ids.add(usage.id);
    assert.equal(usage.prompt.split(BLANK).length, 2, usage.id);
    assert.ok(
      usage.example.includes(usage.prompt.replace(BLANK, usage.answer)),
      `${usage.id}: the example contains the phrase`,
    );
    assert.equal(usage.choices.length, 4, usage.id);
    assert.equal(new Set(usage.choices).size, 4, usage.id);
    assert.equal(usage.choices.filter((c) => c === usage.answer).length, 1);
    // 个 counts almost any noun, so it is never a wrong choice.
    assert.ok(!usage.choices.includes("个"), usage.id);
    assert.ok(usage.pinyin && usage.translation && usage.meaning, usage.id);
  }
});

test("a question shows the noun with its phrase, pinyin and shuffled choices", () => {
  const usage = MEASURE_WORD_USAGES[0];
  const q = measureWordQuestion(usage, seeded(3));
  assert.equal(q.noun, usage.noun);
  assert.equal(q.phrase, usage.prompt.replace(BLANK, usage.answer));
  assert.notEqual(q.examplePinyin, "");
  assert.deepEqual([...q.choices].sort(), [...usage.choices].sort());
});

test("a quiz has 25 different questions", () => {
  const quiz = buildMeasureWordQuiz(25, seeded(7));
  assert.equal(quiz.length, 25);
  assert.equal(new Set(quiz.map((q) => q.id)).size, 25);
  assert.equal(buildMeasureWordQuiz(0).length, 0);
});

test("review finds measure-word questions among the complement items", () => {
  const id = MEASURE_WORD_USAGES[5].id;
  assert.ok(isMeasureWordQuestionId(id));
  assert.equal(reviewQuestion("complement", id)?.answer, "把");
  assert.deepEqual(
    (({ label, compact }) => ({ label, compact }))(
      reviewChoice("complement", id)!,
    ),
    { label: "量詞", compact: false },
  );
  assert.equal(reviewQuestion("complement", "measure-99"), null);
});

test("the round modes add measure to the complement modes", () => {
  assert.ok((COMPLEMENT_ROUND_MODES as readonly string[]).includes("measure"));
  assert.ok((COMPLEMENT_ROUND_MODES as readonly string[]).includes("verb"));
  assert.equal(roundModeLabel("measure"), "量詞");
  assert.equal(roundModeLabel("result"), "結果補語");
});
