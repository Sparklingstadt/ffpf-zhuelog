import assert from "node:assert/strict";
import { test } from "node:test";
import { PREPOSITION_USAGES } from "../src/domain/practice/preposition-data";
import {
  BLANK,
  buildQuestion,
  buildQuiz,
  categoriesOf,
  CHOICE_COUNT,
  progressPercent,
  wrongChoicesFor,
} from "../src/domain/practice/preposition-quiz";

// Deterministic stand-in for Math.random.
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

const pairs = PREPOSITION_USAGES.flatMap((usage) =>
  usage.pairs.map((pair) => ({ usage, pair })),
);

test("every generated phrase holds its noun and, apart from it, the preposition", () => {
  assert.ok(pairs.length >= 300);
  for (const { usage, pair } of pairs) {
    assert.ok(pair.phrase.includes(pair.noun), usage.id);
    assert.equal(
      pair.phrase.slice(pair.at, pair.at + usage.preposition.length),
      usage.preposition,
      usage.id,
    );
  }
});

test("a question blanks out the preposition and keeps the rest of the phrase", () => {
  const usage = PREPOSITION_USAGES.find((u) => u.id === "P001")!;
  const question = buildQuestion(usage, usage.pairs[0], seeded(1));
  assert.equal(question.noun, "学校");
  assert.equal(question.prompt, `${BLANK}学校学习`);
  assert.equal(question.answer, "在");

  const after = PREPOSITION_USAGES.find((u) =>
    u.pairs.some((pair) => pair.at > 0),
  )!;
  const pair = after.pairs.find((p) => p.at > 0)!;
  const { prompt } = buildQuestion(after, pair, seeded(1));
  assert.equal(
    prompt.replace(BLANK, after.preposition),
    pair.phrase,
    `${after.id}: ${prompt}`,
  );
});

test("wrong choices never share a category with the answer", () => {
  for (const preposition of new Set(
    PREPOSITION_USAGES.map((usage) => usage.preposition),
  )) {
    const own = categoriesOf(preposition);
    const wrong = wrongChoicesFor(preposition);
    assert.ok(wrong.length >= CHOICE_COUNT - 1, preposition);
    assert.ok(!wrong.includes(preposition), preposition);
    for (const choice of wrong)
      for (const category of categoriesOf(choice))
        assert.ok(!own.has(category), `${preposition} vs ${choice}`);
  }
});

test("near-synonyms are never offered as wrong choices", () => {
  for (const [answer, synonym] of [
    ["从", "自"],
    ["按照", "依照"],
    ["跟", "和"],
    ["把", "将"],
    ["被", "让"],
    ["因为", "为"],
    ["对", "冲着"],
    ["由于", "由"],
  ])
    assert.ok(!wrongChoicesFor(answer).includes(synonym), answer);
});

test("a question offers four distinct choices with exactly one answer", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const random = seeded(seed);
    for (const { usage, pair } of pairs) {
      const { choices, answer } = buildQuestion(usage, pair, random);
      assert.equal(choices.length, CHOICE_COUNT);
      assert.equal(new Set(choices).size, CHOICE_COUNT);
      assert.equal(choices.filter((choice) => choice === answer).length, 1);
    }
  }
});

test("the answer lands in every position", () => {
  const random = seeded(7);
  const { usage, pair } = pairs[0];
  const positions = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const { choices, answer } = buildQuestion(usage, pair, random);
    positions.add(choices.indexOf(answer));
  }
  assert.deepEqual([...positions].sort(), [0, 1, 2, 3]);
});

test("a quiz asks about different prepositions", () => {
  for (const count of [10, 25]) {
    const quiz = buildQuiz(count, seeded(3));
    assert.equal(quiz.length, count);
    assert.equal(new Set(quiz.map((question) => question.answer)).size, count);
  }
});

test("progress grows with each question and stops at 100%", () => {
  assert.equal(progressPercent(0, 10), 0);
  assert.equal(progressPercent(1, 10), 10);
  assert.equal(progressPercent(10, 10), 100);
  assert.equal(progressPercent(12, 10), 100);
  assert.equal(progressPercent(-1, 10), 0);
  assert.equal(progressPercent(3, 0), 0);
});
