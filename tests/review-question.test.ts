import assert from "node:assert/strict";
import test from "node:test";

import { COMPLEMENT_USAGES } from "../src/domain/practice/complement-data";
import { COMPLEMENT_VERB_USAGES } from "../src/domain/practice/complement-verb-data";
import { verbQuestionId } from "../src/domain/practice/complement-verb-quiz";
import { PREPOSITION_USAGES } from "../src/domain/practice/preposition-data";
import {
  reviewChoice,
  reviewQuestion,
} from "../src/domain/practice/review-question";
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

test("a verb-mode complement item names a use and one of its verbs", () => {
  const usage = COMPLEMENT_VERB_USAGES.find((u) => u.pairs.length > 1)!;
  const pair = usage.pairs[1];
  const id = verbQuestionId(usage.id, pair.verb);
  const q = reviewQuestion("complement", id);
  assert.ok(q);
  assert.equal(q.id, id);
  assert.equal(q.noun, pair.verb);
  assert.equal(q.answer, usage.complement);
  assert.equal(q.phrase, pair.phrase);
  assert.ok(q.choices.includes(usage.complement));
  assert.equal(q.choices.length, 4);
  assert.equal(
    reviewQuestion("complement", `verb:${usage.id}:存在しない動詞`),
    null,
  );
  assert.equal(reviewQuestion("complement", "verb:C999:看"), null);
});

test("a review card shows prepositions and verb-mode complements large, other complements compact", () => {
  const preposition = PREPOSITION_USAGES[0];
  const p = reviewChoice(
    "preposition",
    `${preposition.id}:${preposition.pairs[0].noun}`,
  );
  assert.ok(p);
  assert.equal(p.label, "介詞");
  assert.equal(p.compact, false);
  assert.equal(p.question.noun, preposition.pairs[0].noun);

  const verb = COMPLEMENT_VERB_USAGES[0];
  const v = reviewChoice(
    "complement",
    verbQuestionId(verb.id, verb.pairs[0].verb),
  );
  assert.ok(v);
  assert.equal(v.label, "補語");
  assert.equal(v.compact, false);
  assert.equal(v.question.noun, verb.pairs[0].verb);

  const authored = COMPLEMENT_USAGES[0];
  const c = reviewChoice("complement", authored.id);
  assert.ok(c);
  assert.equal(c.label, "結果補語");
  assert.equal(c.compact, true);

  assert.equal(reviewChoice("complement", "no-such-question"), null);
  assert.equal(reviewChoice("vocabulary", "你好"), null);
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
