import assert from "node:assert/strict";
import { test } from "node:test";

import { ASPECT_PARTICLE_USAGES } from "../src/domain/practice/aspect-particle-data";
import {
  ASPECT_PARTICLE_CHOICES,
  aspectParticleQuestion,
  aspectParticleSentence,
  aspectParticleUsageLevel,
  buildAspectParticleQuiz,
  countAspectParticleQuestions,
  isAspectParticleQuestionId,
  NO_PARTICLE,
} from "../src/domain/practice/aspect-particle-quiz";
import {
  COMPLEMENT_ROUND_MODES,
  roundModeLabel,
} from "../src/domain/practice/complement-record";
import { HSK_BASES, HSK_LEVELS } from "../src/domain/practice/hsk-level";
import { BLANK } from "../src/domain/practice/preposition-quiz";
import {
  reviewChoice,
  reviewQuestion,
} from "../src/domain/practice/review-question";

// A seeded random, so the tests do not depend on Math.random.
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

test("every 了・过・着 question is well formed", () => {
  const ids = new Set<string>();
  const prompts = new Set<string>();
  for (const usage of ASPECT_PARTICLE_USAGES) {
    assert.match(usage.id, /^aspect-\d{2}$/);
    assert.ok(!ids.has(usage.id), `duplicate id ${usage.id}`);
    ids.add(usage.id);
    assert.ok(!prompts.has(usage.prompt), `duplicate prompt ${usage.id}`);
    prompts.add(usage.prompt);
    assert.equal(usage.prompt.split(BLANK).length, 2, usage.id);
    assert.ok(
      (ASPECT_PARTICLE_CHOICES as readonly string[]).includes(usage.answer),
      usage.id,
    );
    assert.match(usage.prompt, /[。？！”]$/, usage.id);
    assert.ok(usage.translation.endsWith("。"), usage.id);
    // The Go API keeps prompts of up to 100 characters.
    assert.ok([...usage.prompt].length <= 100, usage.id);
  }
});

test("each choice is the answer of a quarter of the questions", () => {
  const counts = ASPECT_PARTICLE_CHOICES.map(
    (choice) =>
      ASPECT_PARTICLE_USAGES.filter((usage) => usage.answer === choice).length,
  );
  assert.deepEqual(counts, [12, 12, 12, 12]);
});

test("the sentence has the particle in the blank, or nothing for なし", () => {
  const withParticle = ASPECT_PARTICLE_USAGES.find((u) => u.answer === "过")!;
  assert.equal(
    aspectParticleSentence(withParticle),
    withParticle.prompt.replace(BLANK, "过"),
  );
  const without = ASPECT_PARTICLE_USAGES.find((u) => u.answer === NO_PARTICLE)!;
  const sentence = aspectParticleSentence(without);
  assert.equal(sentence, without.prompt.replace(BLANK, ""));
  assert.ok(!sentence.includes(NO_PARTICLE));
});

test("a question shows the sentence under the practice's name, with the choices in a fixed order", () => {
  for (const usage of ASPECT_PARTICLE_USAGES) {
    const q = aspectParticleQuestion(usage);
    assert.equal(q.id, usage.id);
    assert.equal(q.noun, "了・过・着");
    assert.equal(q.meaning, usage.translation);
    assert.equal(q.prompt, usage.prompt);
    assert.equal(q.example, aspectParticleSentence(usage));
    assert.equal(q.phrase, q.example);
    assert.notEqual(q.examplePinyin, "", usage.id);
    assert.deepEqual(q.choices, ["了", "过", "着", "なし"]);
    assert.equal(q.answer, usage.answer);
  }
  const pinyin = (answer: string) =>
    aspectParticleQuestion(
      ASPECT_PARTICLE_USAGES.find((u) => u.answer === answer)!,
    ).pinyin;
  assert.deepEqual(["了", "过", "着", NO_PARTICLE].map(pinyin), [
    "le",
    "guo",
    "zhe",
    "",
  ]);
});

test("a quiz has 25 different questions", () => {
  const quiz = buildAspectParticleQuiz(25, seeded(7));
  assert.equal(quiz.length, 25);
  assert.equal(new Set(quiz.map((q) => q.id)).size, 25);
  assert.equal(buildAspectParticleQuiz(0).length, 0);
  assert.equal(countAspectParticleQuestions(), ASPECT_PARTICLE_USAGES.length);
});

for (const basis of HSK_BASES) {
  test(`${basis}: every 了・过・着 question has one level and the quizzes keep to it`, () => {
    const split = HSK_LEVELS.reduce(
      (n, level) => n + countAspectParticleQuestions({ level, basis }),
      0,
    );
    assert.equal(split, ASPECT_PARTICLE_USAGES.length);
    for (const level of HSK_LEVELS) {
      const filter = { level, basis };
      const quiz = buildAspectParticleQuiz(25, seeded(level), filter);
      assert.equal(
        quiz.length,
        Math.min(25, countAspectParticleQuestions(filter)),
      );
      for (const q of quiz) {
        const usage = ASPECT_PARTICLE_USAGES.find((u) => u.id === q.id)!;
        assert.equal(aspectParticleUsageLevel(usage, basis), level, q.id);
      }
    }
    // Some questions are above level 4 either way.
    assert.ok(countAspectParticleQuestions({ level: 5, basis }) > 0);
  });
}

test("review finds 了・过・着 questions among the complement items", () => {
  const usage = ASPECT_PARTICLE_USAGES[12];
  assert.ok(isAspectParticleQuestionId(usage.id));
  assert.ok(!isAspectParticleQuestionId("measure-01"));
  assert.equal(reviewQuestion("complement", usage.id)?.answer, usage.answer);
  assert.deepEqual(
    (({ label, compact }) => ({ label, compact }))(
      reviewChoice("complement", usage.id)!,
    ),
    { label: "了・过・着", compact: true },
  );
  assert.equal(reviewQuestion("complement", "aspect-99"), null);
  assert.equal(reviewQuestion("preposition", usage.id), null);
});

test("the round modes add aspect to the complement modes", () => {
  assert.ok((COMPLEMENT_ROUND_MODES as readonly string[]).includes("aspect"));
  assert.ok((COMPLEMENT_ROUND_MODES as readonly string[]).includes("measure"));
  assert.equal(roundModeLabel("aspect"), "了・过・着");
  assert.equal(roundModeLabel("measure"), "量詞");
});
