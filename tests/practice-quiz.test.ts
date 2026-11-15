import assert from "node:assert/strict";
import { test } from "node:test";

import { PRACTICE_QUESTION_COUNT } from "../src/domain/practice/choice-question";
import { COMPLEMENT_MODES } from "../src/domain/practice/complement-quiz";
import { inHskFilter } from "../src/domain/practice/hsk-level";
import {
  buildPracticeQuiz,
  parsePracticeQuizKind,
} from "../src/domain/practice/practice-quiz";

test("parsePracticeQuizKind accepts every practice and each complement mode", () => {
  for (const kind of ["preposition", "measure-word", "aspect-particle"])
    assert.equal(parsePracticeQuizKind(kind), kind);
  for (const mode of Object.keys(COMPLEMENT_MODES))
    assert.equal(
      parsePracticeQuizKind(`complement:${mode}`),
      `complement:${mode}`,
    );
});

test("parsePracticeQuizKind rejects anything else", () => {
  for (const value of [
    "",
    "complement",
    "complement:nope",
    "prepositions",
    42,
    null,
    undefined,
    { kind: "preposition" },
  ])
    assert.equal(parsePracticeQuizKind(value), null);
});

test("buildPracticeQuiz builds a full round of each kind", () => {
  const kinds = [
    "preposition",
    "measure-word",
    "aspect-particle",
    ...Object.keys(COMPLEMENT_MODES).map((mode) => `complement:${mode}`),
  ];
  for (const value of kinds) {
    const kind = parsePracticeQuizKind(value);
    assert.ok(kind, value);
    const quiz = buildPracticeQuiz(kind, PRACTICE_QUESTION_COUNT, Math.random);
    assert.ok(quiz.length > 0, value);
    assert.ok(quiz.length <= PRACTICE_QUESTION_COUNT, value);
    for (const question of quiz)
      assert.ok(question.choices.includes(question.answer), value);
  }
});

test("buildPracticeQuiz keeps to the HSK filter", () => {
  const filter = { level: 4 as const, basis: "curated" as const };
  const quiz = buildPracticeQuiz("preposition", 25, Math.random, filter);
  assert.ok(quiz.length > 0);
  for (const question of quiz)
    assert.ok(inHskFilter(filter, question.phrase, question.example));
});
