import assert from "node:assert/strict";
import { test } from "node:test";

import { practiceAnswerInput } from "../src/presentation/actions/practice-round-input";

const answer = {
  answer: "在",
  noun: "学校",
  prompt: "（　）学校学习",
  misses: ["把"],
};

test("a sent answer keeps its question's id", () => {
  assert.deepEqual(practiceAnswerInput.parse({ id: "P001", ...answer }), {
    id: "P001",
    ...answer,
  });
});

test("an answer without an id is still valid", () => {
  assert.deepEqual(practiceAnswerInput.parse(answer), answer);
});

test("an id that is not text is refused", () => {
  assert.equal(
    practiceAnswerInput.safeParse({ id: 1, ...answer }).success,
    false,
  );
});
