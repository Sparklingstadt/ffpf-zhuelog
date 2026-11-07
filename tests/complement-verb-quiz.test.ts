import assert from "node:assert/strict";
import { test } from "node:test";

import { COMPLEMENT_VERB_USAGES } from "../src/domain/practice/complement-verb-data";
import {
  buildComplementVerbQuiz,
  categoriesOfComplement,
  complementVerbQuestion,
  complementVerbQuestionById,
  type ComplementVerbUsage,
  countComplementVerbQuestions,
  verbQuestionId,
  wrongComplementsFor,
} from "../src/domain/practice/complement-verb-quiz";
import { BLANK, CHOICE_COUNT } from "../src/domain/practice/preposition-quiz";

// Deterministic stand-in for Math.random.
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

const pairs = COMPLEMENT_VERB_USAGES.flatMap((usage) =>
  usage.pairs.map((pair) => ({ usage, pair })),
);

// A usage with only what the choice rules look at.
function u(
  id: string,
  complement: string,
  category: string,
  pairs: [verb: string, phrase: string, at: number][],
): ComplementVerbUsage {
  return {
    id,
    complement,
    pinyin: "",
    meaning: "",
    category,
    pairs: pairs.map(([verb, phrase, at]) => ({ verb, phrase, at })),
    example: "",
    translation: "",
  };
}

test("every phrase holds its verb and, right after it, the complement", () => {
  assert.ok(pairs.length >= 200);
  assert.equal(countComplementVerbQuestions(), pairs.length);
  for (const { usage, pair } of pairs) {
    assert.equal(
      pair.phrase.slice(pair.at, pair.at + usage.complement.length),
      usage.complement,
      usage.id,
    );
    assert.equal(
      pair.at,
      pair.phrase.indexOf(pair.verb) + pair.verb.length,
      `${usage.id}: ${pair.phrase}`,
    );
  }
});

test("the data covers the six categories with at least 30 complements", () => {
  assert.deepEqual(
    [...new Set(COMPLEMENT_VERB_USAGES.map((u) => u.category))].sort(),
    [
      "程度・様態補語",
      "結果補語",
      "方向補語（単純）",
      "方向補語（派生）",
      "方向補語（複合）",
      "可能補語",
    ].sort(),
  );
  assert.ok(
    new Set(COMPLEMENT_VERB_USAGES.map((u) => u.complement)).size >= 30,
  );
});

test("wrong choices never share a category, pair with the verb, or contain the answer", () => {
  const usages = [
    u("C1", "懂", "結果補語", [["看", "看懂这本书", 1]]),
    u("C2", "完", "結果補語", [["看", "看完这本书", 1]]),
    u("C3", "得懂", "可能補語", [["听", "听得懂", 1]]),
    u("C4", "下来", "方向補語（複合）", [["停", "停下来", 1]]),
    u("C5", "下", "方向補語（単純）", [["放", "放下", 1]]),
    u("C6", "得很", "程度・様態補語", [["好", "好得很", 1]]),
    u("C7", "起来", "方向補語（複合）", [["看", "看起来", 1]]),
  ];
  assert.deepEqual(
    [...categoriesOfComplement("下", usages)],
    ["方向補語（単純）"],
  );
  // 完 shares the category, 得懂 contains 懂, 起来 pairs with 看.
  assert.deepEqual(wrongComplementsFor("懂", "看", usages).sort(), [
    "下",
    "下来",
    "得很",
  ]);
  // 下来 contains 下; 起来 is another category and does not pair with 放.
  assert.deepEqual(
    wrongComplementsFor("下", "放", usages).sort(),
    ["得很", "得懂", "完", "懂", "起来"].sort(),
  );
});

test("every question in the data has three wrong choices that obey the rules", () => {
  for (const { usage, pair } of pairs) {
    const wrong = wrongComplementsFor(usage.complement, pair.verb);
    assert.ok(wrong.length >= CHOICE_COUNT - 1, `${usage.id} ${pair.verb}`);
    for (const w of wrong) {
      assert.ok(
        !w.includes(usage.complement) && !usage.complement.includes(w),
        `${usage.id}: ${w}`,
      );
      assert.ok(
        !COMPLEMENT_VERB_USAGES.some(
          (o) =>
            o.complement === w && o.pairs.some((p) => p.verb === pair.verb),
        ),
        `${usage.id}: ${w} pairs with ${pair.verb}`,
      );
    }
  }
});

test("a question shows the verb, blanks the complement and names itself by usage and verb", () => {
  const usage = COMPLEMENT_VERB_USAGES.find((u) => u.id === "C005")!;
  const pair = usage.pairs[0];
  const q = complementVerbQuestion(usage, pair, seeded(1));
  assert.equal(q.id, verbQuestionId(usage.id, pair.verb));
  assert.equal(q.id, `verb:C005:${pair.verb}`);
  assert.equal(q.noun, pair.verb);
  assert.equal(q.meaning, usage.meaning);
  assert.equal(q.answer, usage.complement);
  assert.equal(q.prompt.replace(BLANK, usage.complement), pair.phrase);
  assert.equal(q.phrase, pair.phrase);
  assert.equal(q.pinyin, usage.pinyin);
  assert.equal(q.example, usage.example);
  assert.equal(q.translation, usage.translation);
  assert.equal(q.choices.length, CHOICE_COUNT);
  assert.equal(new Set(q.choices).size, CHOICE_COUNT);
  assert.equal(q.choices.filter((c) => c === q.answer).length, 1);
});

test("a question is found again by its id, and unknown ids are null", () => {
  const { usage, pair } = pairs[7];
  const q = complementVerbQuestionById(
    verbQuestionId(usage.id, pair.verb),
    seeded(2),
  );
  assert.ok(q);
  assert.equal(q.answer, usage.complement);
  assert.equal(q.noun, pair.verb);
  assert.equal(q.phrase, pair.phrase);
  assert.equal(complementVerbQuestionById("verb:C999:看"), null);
  assert.equal(
    complementVerbQuestionById(`verb:${usage.id}:存在しない動詞`),
    null,
  );
  assert.equal(complementVerbQuestionById("result-01"), null);
  assert.equal(complementVerbQuestionById("verb:"), null);
});

test("a quiz of 25 asks about different complements, each id at most once", () => {
  for (let seed = 1; seed <= 5; seed++) {
    const quiz = buildComplementVerbQuiz(25, seeded(seed));
    assert.equal(quiz.length, 25);
    assert.equal(new Set(quiz.map((q) => q.answer)).size, 25);
    assert.equal(new Set(quiz.map((q) => q.id)).size, 25);
  }
  assert.equal(buildComplementVerbQuiz(0).length, 0);
});
