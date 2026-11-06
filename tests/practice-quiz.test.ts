import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BLANK,
  buildQuestion,
  buildQuiz,
  categoriesOf,
  CHOICE_COUNT,
  type PracticeUsage,
  progressPercent,
  type QuizSource,
  wrongChoicesFor,
} from "../src/domain/practice/practice-quiz";
import { PREPOSITION_ALSO_IN } from "../src/domain/practice/preposition-also-in";
import { PREPOSITION_USAGES } from "../src/domain/practice/preposition-data";

// Deterministic stand-in for Math.random.
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

const PREPOSITION_SOURCE: QuizSource = {
  usages: PREPOSITION_USAGES,
  alsoIn: PREPOSITION_ALSO_IN,
};

const pairs = PREPOSITION_USAGES.flatMap((usage) =>
  usage.pairs.map((pair) => ({ usage, pair })),
);

// A usage with only what the choice rules look at.
function u(
  id: string,
  word: string,
  category: string,
  pairs: [headword: string, phrase: string, at: number][],
): PracticeUsage {
  return {
    id,
    word,
    pinyin: "",
    meaning: "",
    category,
    pairs: pairs.map(([headword, phrase, at]) => ({ headword, phrase, at })),
    example: "",
    translation: "",
  };
}

test("every generated phrase holds its headword and, apart from it, the preposition", () => {
  assert.ok(pairs.length >= 300);
  for (const { usage, pair } of pairs) {
    assert.ok(pair.phrase.includes(pair.headword), usage.id);
    assert.equal(
      pair.phrase.slice(pair.at, pair.at + usage.word.length),
      usage.word,
      usage.id,
    );
  }
});

test("a question blanks out the preposition and keeps the rest of the phrase", () => {
  const usage = PREPOSITION_USAGES.find((u) => u.id === "P001")!;
  const question = buildQuestion(
    PREPOSITION_SOURCE,
    usage,
    usage.pairs[0],
    seeded(1),
  );
  assert.equal(question.headword, "学校");
  assert.equal(question.prompt, `${BLANK}学校学习`);
  assert.equal(question.answer, "在");

  const after = PREPOSITION_USAGES.find((u) =>
    u.pairs.some((pair) => pair.at > 0),
  )!;
  const pair = after.pairs.find((p) => p.at > 0)!;
  const { prompt } = buildQuestion(PREPOSITION_SOURCE, after, pair, seeded(1));
  assert.equal(
    prompt.replace(BLANK, after.word),
    pair.phrase,
    `${after.id}: ${prompt}`,
  );
});

test("wrong choices never share a category with the answer", () => {
  for (const preposition of new Set(
    PREPOSITION_USAGES.map((usage) => usage.word),
  )) {
    const own = categoriesOf(preposition, PREPOSITION_SOURCE);
    const wrong = wrongChoicesFor(preposition, "学校", PREPOSITION_SOURCE);
    assert.ok(wrong.length >= CHOICE_COUNT - 1, preposition);
    assert.ok(!wrong.includes(preposition), preposition);
    for (const choice of wrong)
      for (const category of categoriesOf(choice, PREPOSITION_SOURCE))
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
    assert.ok(
      !wrongChoicesFor(answer, "学校", PREPOSITION_SOURCE).includes(synonym),
      answer,
    );
});

test("wrong choices never pair with the headword, nor contain or sit inside the answer", () => {
  const source: QuizSource = {
    usages: [
      u("C1", "懂", "結果補語", [["看", "看懂这本书", 1]]),
      u("C2", "完", "結果補語", [["看", "看完这本书", 1]]),
      u("C3", "得懂", "可能補語", [["听", "听得懂", 1]]),
      u("C4", "下来", "方向補語（複合）", [["停", "停下来", 1]]),
      u("C5", "下", "方向補語（単純）", [["放", "放下", 1]]),
      u("C6", "得很", "程度補語", [["好", "好得很", 1]]),
      u("C7", "起来", "方向補語（複合）", [["看", "看起来", 1]]),
    ],
  };
  // 完 shares the category, 得懂 contains 懂, 起来 pairs with 看.
  assert.deepEqual(wrongChoicesFor("懂", "看", source).sort(), [
    "下",
    "下来",
    "得很",
  ]);
  // 下来 contains 下; 起来 is another category and does not pair with 放.
  assert.deepEqual(
    wrongChoicesFor("下", "放", source).sort(),
    ["得很", "得懂", "完", "懂", "起来"].sort(),
  );
});

test("a question offers four distinct choices with exactly one answer", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const random = seeded(seed);
    for (const { usage, pair } of pairs) {
      const { choices, answer } = buildQuestion(
        PREPOSITION_SOURCE,
        usage,
        pair,
        random,
      );
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
    const { choices, answer } = buildQuestion(
      PREPOSITION_SOURCE,
      usage,
      pair,
      random,
    );
    positions.add(choices.indexOf(answer));
  }
  assert.deepEqual([...positions].sort(), [0, 1, 2, 3]);
});

test("a quiz asks about different prepositions", () => {
  for (const count of [10, 25]) {
    const quiz = buildQuiz(PREPOSITION_SOURCE, count, seeded(3));
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
