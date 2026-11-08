import assert from "node:assert/strict";
import { test } from "node:test";

import { COMPLEMENT_USAGES } from "../src/domain/practice/complement-data";
import {
  buildComplementQuiz,
  complementUsageLevel,
  countComplementQuestions,
} from "../src/domain/practice/complement-quiz";
import { COMPLEMENT_VERB_USAGES } from "../src/domain/practice/complement-verb-data";
import {
  HSK_LEVELS,
  hardWordsIn,
  hskLevelOf,
  parseHskLevel,
} from "../src/domain/practice/hsk-level";
import { HSK_HARD_WORDS } from "../src/domain/practice/hsk-words";
import { PREPOSITION_USAGES } from "../src/domain/practice/preposition-data";
import {
  buildQuiz,
  countPrepositionQuestionsByLevel,
} from "../src/domain/practice/preposition-quiz";

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Every text a practice question shows: phrases and example sentences.
const texts = [
  ...PREPOSITION_USAGES.flatMap((u) => [
    u.example,
    ...u.pairs.map((p) => p.phrase),
  ]),
  ...COMPLEMENT_USAGES.map((u) => u.prompt.replace("（　）", u.answer)),
  ...COMPLEMENT_VERB_USAGES.flatMap((u) => [
    u.example,
    ...u.pairs.map((p) => p.phrase),
  ]),
];

test("?hsk= reads 4, 5 or 6 and nothing else", () => {
  assert.equal(parseHskLevel("5"), 5);
  assert.equal(parseHskLevel(["6", "4"]), 6);
  for (const bad of [undefined, "", "3", "7", "4.0x", "all", null])
    assert.equal(parseHskLevel(bad), null, String(bad));
});

test("the word table holds levels 5, 6 and 7-9 of words the practices use", () => {
  for (const [word, level] of Object.entries(HSK_HARD_WORDS)) {
    assert.ok([5, 6, 7].includes(level), word);
    assert.ok(/^[一-鿿]+$/.test(word), word);
    assert.ok(
      texts.some((text) => text.includes(word)),
      `${word} is in no practice text`,
    );
  }
});

test("a text's level is its hardest listed word, 1-4 as 4 and 7-9 as 6", () => {
  assert.equal(hskLevelOf("我去学校。"), 4);
  const byLevel = (level: number) =>
    Object.keys(HSK_HARD_WORDS).find((w) => HSK_HARD_WORDS[w] === level);
  for (const [level, expected] of [
    [5, 5],
    [6, 6],
    [7, 6],
  ] as const) {
    const word = byLevel(level);
    if (!word) continue;
    assert.equal(hskLevelOf(`我${word}。`), expected, word);
    assert.deepEqual(hardWordsIn(`我${word}。`).slice(0, 1), [word]);
  }
});

test("every preposition question has one level and the quizzes keep to it", () => {
  const counts = countPrepositionQuestionsByLevel();
  const total = PREPOSITION_USAGES.reduce((n, u) => n + u.pairs.length, 0);
  assert.equal(counts[4] + counts[5] + counts[6], total);
  for (const level of HSK_LEVELS) {
    const quiz = buildQuiz(25, seeded(level), undefined, level);
    for (const q of quiz)
      assert.equal(hskLevelOf(q.phrase, q.example), level, q.phrase);
    assert.equal(new Set(quiz.map((q) => q.answer)).size, quiz.length);
    if (counts[level] > 0) assert.ok(quiz.length > 0, `level ${level}`);
  }
  assert.equal(buildQuiz(25, seeded(2)).length, 25, "no level keeps 25");
});

test("every complement question has one level and the quizzes keep to it", () => {
  for (const mode of ["result", "degree", "verb"] as const) {
    const all = countComplementQuestions(mode);
    const split = HSK_LEVELS.reduce(
      (n, level) => n + countComplementQuestions(mode, level),
      0,
    );
    assert.equal(split, all, mode);
    for (const level of HSK_LEVELS) {
      const quiz = buildComplementQuiz(mode, 25, seeded(level), level);
      assert.equal(
        quiz.length,
        Math.min(
          25,
          mode === "verb" ? quiz.length : countComplementQuestions(mode, level),
        ),
      );
      for (const q of quiz)
        assert.equal(
          mode === "verb"
            ? hskLevelOf(q.phrase, q.example)
            : hskLevelOf(q.example),
          level,
          q.example,
        );
    }
  }
  const usage = COMPLEMENT_USAGES[0];
  assert.equal(
    complementUsageLevel(usage),
    hskLevelOf(usage.prompt.replace("（　）", usage.answer)),
  );
});

test("a one-character word counts only where it is a word of its own", () => {
  // 经 inside 已经 and 于 inside 关于 are easy words.
  assert.deepEqual(hardWordsIn("我已经吃完了。"), []);
  assert.deepEqual(hardWordsIn("我对于这件事没意见。"), []);
  assert.equal(hskLevelOf("我们讨论了关于学校的事。"), 4);
  // 于 and 经 standing alone are the hard written words.
  assert.ok(hardWordsIn("会议定于十点开始。").includes("于"));
  assert.ok(hardWordsIn("经双方同意，合同延期。").includes("经"));
});
