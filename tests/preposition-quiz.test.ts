import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildQuestion,
  buildQuiz,
  CHOICE_COUNT,
  PREPOSITION_ITEMS,
  PREPOSITIONS,
  progressPercent,
} from "../src/domain/practice/preposition-quiz";

// Deterministic stand-in for Math.random.
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

test("every item's answer and alternatives are offered prepositions", () => {
  for (const item of PREPOSITION_ITEMS) {
    assert.ok(PREPOSITIONS.includes(item.answer), item.noun);
    for (const fits of item.alsoFits ?? []) {
      assert.ok(PREPOSITIONS.includes(fits), item.noun);
      assert.notEqual(fits, item.answer, item.noun);
    }
  }
  const nouns = PREPOSITION_ITEMS.map((item) => item.noun);
  assert.equal(new Set(nouns).size, nouns.length);
});

test("a question offers four distinct choices with exactly one fitting", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const random = seeded(seed);
    for (const item of PREPOSITION_ITEMS) {
      const { choices, answer } = buildQuestion(item, random);
      assert.equal(choices.length, CHOICE_COUNT);
      assert.equal(new Set(choices).size, CHOICE_COUNT);
      assert.equal(choices.filter((choice) => choice === answer).length, 1);
      for (const fits of item.alsoFits ?? [])
        assert.ok(!choices.includes(fits), `${item.noun}: ${fits}`);
    }
  }
});

test("the answer lands in every position", () => {
  const random = seeded(7);
  const positions = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const { choices, answer } = buildQuestion(PREPOSITION_ITEMS[0], random);
    positions.add(choices.indexOf(answer));
  }
  assert.deepEqual([...positions].sort(), [0, 1, 2, 3]);
});

test("a quiz asks about different nouns", () => {
  const quiz = buildQuiz(10, seeded(3));
  assert.equal(quiz.length, 10);
  assert.equal(new Set(quiz.map((question) => question.noun)).size, 10);
  assert.equal(buildQuiz(1000, seeded(3)).length, PREPOSITION_ITEMS.length);
});

test("progress grows with each question and stops at 100%", () => {
  assert.equal(progressPercent(0, 10), 0);
  assert.equal(progressPercent(1, 10), 10);
  assert.equal(progressPercent(10, 10), 100);
  assert.equal(progressPercent(12, 10), 100);
  assert.equal(progressPercent(-1, 10), 0);
  assert.equal(progressPercent(3, 0), 0);
});
