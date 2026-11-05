import assert from "node:assert/strict";
import test from "node:test";

import { COMPLEMENT_USAGES } from "../src/domain/practice/complement-data";
import { PREPOSITION_USAGES } from "../src/domain/practice/preposition-data";
import { reviewQuestion } from "../src/domain/practice/review-question";
import { isReviewRating } from "../src/domain/review/review-item";

test("a preposition item names a use and one of its phrases", () => {
  const usage = PREPOSITION_USAGES.find((u) => u.pairs.length > 1)!;
  const pair = usage.pairs[1];
  const q = reviewQuestion("preposition", `${usage.id}:${pair.noun}`);
  assert.ok(q);
  assert.equal(q.id, usage.id);
  assert.equal(q.noun, pair.noun);
  assert.equal(q.answer, usage.preposition);
  assert.equal(q.phrase, pair.phrase);
  assert.ok(q.choices.includes(usage.preposition));
  assert.equal(q.choices.length, 4);
});

test("a complement item names a question", () => {
  const usage = COMPLEMENT_USAGES[0];
  const q = reviewQuestion("complement", usage.id);
  assert.ok(q);
  assert.equal(q.id, usage.id);
  assert.equal(q.answer, usage.answer);
  assert.equal(q.prompt, usage.prompt);
  assert.deepEqual([...q.choices].sort(), [...usage.choices].sort());
});

test("unknown targets and kinds have no question", () => {
  const usage = PREPOSITION_USAGES[0];
  assert.equal(
    reviewQuestion("preposition", `${usage.id}:存在しない名詞`),
    null,
  );
  assert.equal(reviewQuestion("preposition", "P999999:学校"), null);
  assert.equal(reviewQuestion("preposition", usage.id), null);
  assert.equal(reviewQuestion("preposition", `:${usage.pairs[0].noun}`), null);
  assert.equal(reviewQuestion("complement", "no-such-question"), null);
  assert.equal(reviewQuestion("vocabulary", "你好"), null);
});

test("ratings are 1 to 4", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, "3", 2.5].map(isReviewRating), [
    false,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
  ]);
});
