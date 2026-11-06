import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPLEMENT_USAGES } from "../src/domain/practice/complement-data";
import {
  buildComplementQuiz,
  countComplementQuestions,
  COMPLEMENT_MODES,
} from "../src/domain/practice/complement-quiz";
import { countComplementVerbQuestions } from "../src/domain/practice/complement-verb-quiz";

// Deterministic stand-in for Math.random.
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

// The hand-written modes; the verb mode draws on complement-verb-data.
const AUTHORED_MODES = (
  Object.keys(COMPLEMENT_MODES) as (keyof typeof COMPLEMENT_MODES)[]
).filter((mode) => mode !== "verb");

test("each complement mode gives 25 distinct, complete four-choice questions", () => {
  for (const mode of Object.keys(
    COMPLEMENT_MODES,
  ) as (keyof typeof COMPLEMENT_MODES)[]) {
    for (let i = 0; i < 10; i++) {
      const quiz = buildComplementQuiz(mode, 25);
      assert.equal(quiz.length, 25);
      assert.equal(new Set(quiz.map((q) => q.id)).size, 25);
      for (const q of quiz) {
        assert.equal(q.choices.length, 4);
        assert.equal(new Set(q.choices).size, 4);
        assert.equal(q.choices.filter((c) => c === q.answer).length, 1);
        assert.equal(q.prompt.split("（　）").length, 2);
        assert.equal(q.prompt.replace("（　）", q.answer), q.phrase);
        assert.ok(q.meaning && q.pinyin && q.translation && q.example);
        if (mode === "verb") assert.ok(q.id.startsWith("verb:"), q.id);
        else assert.equal(q.noun, COMPLEMENT_MODES[mode].label);
      }
    }
  }
});

test("retrying shuffles questions and choices without mutating the source", () => {
  const a = buildComplementQuiz("result", 25, () => 0);
  const b = buildComplementQuiz("result", 25, () => 0.999);
  assert.notDeepEqual(
    a.map((q) => q.id),
    b.map((q) => q.id),
  );
  a[0].choices.length = 0;
  assert.equal(buildComplementQuiz("result", 25)[0].choices.length, 4);
  assert.equal(buildComplementQuiz("degree", 0).length, 0);
});

test("every hand-written complement mode holds 100 questions", () => {
  assert.equal(Object.keys(COMPLEMENT_MODES).length, 8);
  assert.equal(AUTHORED_MODES.length, 7);
  assert.equal(new Set(COMPLEMENT_USAGES.map((q) => q.id)).size, 700);
  assert.equal(
    new Set(COMPLEMENT_USAGES.map((q) => q.prompt)).size,
    COMPLEMENT_USAGES.length,
  );
  for (const mode of AUTHORED_MODES) {
    const pool = COMPLEMENT_USAGES.filter((q) => q.mode === mode);
    assert.equal(pool.length, 100);
    assert.ok(pool.every((q) => q.id.startsWith(`${mode}-`)));
  }
});

test("counts the questions available for each complement mode", () => {
  for (const mode of AUTHORED_MODES) {
    assert.equal(
      countComplementQuestions(mode),
      COMPLEMENT_USAGES.filter((q) => q.mode === mode).length,
    );
  }
  assert.equal(countComplementQuestions("result"), 100);
  assert.equal(
    countComplementQuestions("verb"),
    countComplementVerbQuestions(),
  );
  assert.ok(countComplementQuestions("verb") >= 200);
});

test("the verb mode shows a verb and blanks the complement after it", () => {
  const quiz = buildComplementQuiz("verb", 25, seeded(3));
  assert.equal(new Set(quiz.map((q) => q.answer)).size, 25);
  for (const q of quiz) {
    assert.ok(q.id.startsWith("verb:"), q.id);
    assert.ok(q.prompt.startsWith(q.noun), `${q.noun} / ${q.prompt}`);
    assert.equal(q.prompt.replace("（　）", q.answer), q.phrase);
    assert.notEqual(q.example, q.phrase);
  }
  assert.equal(COMPLEMENT_MODES.verb.label, "動詞から選ぶ");
});
