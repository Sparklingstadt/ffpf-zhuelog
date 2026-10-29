import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildComplementQuiz,
  COMPLEMENT_MODES,
} from "../src/domain/practice/complement-quiz";

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
        assert.equal(q.noun, COMPLEMENT_MODES[mode].label);
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
