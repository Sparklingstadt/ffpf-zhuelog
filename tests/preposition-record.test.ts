import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accuracyPercent,
  answerOf,
  formatElapsed,
  scoreRound,
} from "../src/domain/practice/preposition-record";

test("a round's score counts first-try answers and every wrong pick", () => {
  assert.deepEqual(scoreRound([]), {
    questionCount: 0,
    firstTryCount: 0,
    missCount: 0,
  });
  assert.deepEqual(
    scoreRound([{ misses: [] }, { misses: ["把", "被"] }, { misses: ["对"] }]),
    { questionCount: 3, firstTryCount: 1, missCount: 3 },
  );
});

test("an answer records which question it was, with its misses", () => {
  const question = {
    id: "P001",
    answer: "在",
    noun: "学校",
    prompt: "（　）学校学习",
    meaning: "〜で",
    phrase: "在学校学习",
    pinyin: "zài",
    example: "我在学校学习。",
    translation: "私は学校で勉強します。",
    choices: ["在", "把", "被", "对"],
  };
  assert.deepEqual(answerOf(question, ["把"]), {
    id: "P001",
    answer: "在",
    noun: "学校",
    prompt: "（　）学校学习",
    misses: ["把"],
  });
});

test("accuracy is a whole percent of the answered questions", () => {
  assert.equal(accuracyPercent(0, 0), null);
  assert.equal(accuracyPercent(0, 25), 0);
  assert.equal(accuracyPercent(20, 25), 80);
  assert.equal(accuracyPercent(2, 3), 67);
  assert.equal(accuracyPercent(25, 25), 100);
});

test("elapsed time reads m:ss, and h:mm:ss from an hour on", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(-500), "0:00");
  assert.equal(formatElapsed(9_999), "0:09");
  assert.equal(formatElapsed(83_250), "1:23");
  assert.equal(formatElapsed(10 * 60_000), "10:00");
  assert.equal(formatElapsed(3_600_000 + 65_000), "1:01:05");
});
