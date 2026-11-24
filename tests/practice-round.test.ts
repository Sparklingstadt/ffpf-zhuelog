import assert from "node:assert/strict";
import test from "node:test";

import type { ChoiceAnswer } from "../src/domain/practice/practice-record";
import {
  checkPracticeRound,
  choiceAnswersFrom,
  PRACTICE_ROUND_LIMITS,
  practiceReviewTargets,
  type PracticeRound,
} from "../src/domain/practice/practice-round";

const ROUND_ID = "0b0d5a8e-1c2f-4e3a-9b7c-1d2e3f4a5b6c";

function question(answer: string, ...misses: string[]): ChoiceAnswer {
  return { answer, noun: "学校", prompt: "（　）学校学习", misses };
}

function round(elapsedMs: number, ...questions: ChoiceAnswer[]): PracticeRound {
  return {
    id: ROUND_ID,
    startedAt: new Date("2026-10-20T11:58:00.000Z"),
    elapsedMs,
    questions,
  };
}

const preposition = (r: PracticeRound & { mode?: unknown }) =>
  checkPracticeRound("preposition", r);
const complement = (r: PracticeRound, mode: unknown = "result") =>
  checkPracticeRound("complement", { ...r, mode });

test("a round is checked for its bounds and its questions", () => {
  const many = Array.from({ length: PRACTICE_ROUND_LIMITS.questions + 1 }, () =>
    question("在"),
  );
  const invalid: Record<string, PracticeRound> = {
    "no questions": round(1000),
    "too many questions": round(1000, ...many),
    "negative time": round(-1, question("在")),
    "over a day": round(86_400_001, question("在")),
    "partial milliseconds": round(1.5, question("在")),
    "no answer": round(1000, question("")),
    "answer as a miss": round(1000, question("在", "在")),
    "repeated miss": round(1000, question("在", "把", "把")),
    "four misses": round(1000, question("在", "把", "被", "对", "向")),
    "empty miss": round(1000, question("在", "")),
    "long prompt": round(1000, {
      ...question("在"),
      prompt: "字".repeat(101),
    }),
    "long id": round(1000, { ...question("在"), id: "a".repeat(41) }),
    "bad startedAt": {
      ...round(1, question("在")),
      startedAt: new Date("yesterday"),
    },
    "not a uuid": { ...round(1, question("在")), id: "not-a-uuid" },
    "an upper-case uuid": {
      ...round(1, question("在")),
      id: ROUND_ID.toUpperCase(),
    },
  };
  for (const [name, r] of Object.entries(invalid)) {
    assert.equal(preposition(r), null, `preposition: ${name}`);
    assert.equal(complement(r), null, `complement: ${name}`);
  }

  assert.equal(complement(round(1, question("完")), "unknown"), null);
  assert.equal(
    checkPracticeRound("complement", {
      ...round(1, question("完")),
    } as PracticeRound & { mode: unknown }),
    null,
    "a complement round without a mode",
  );
  assert.equal(
    preposition({ ...round(1, question("在")), mode: "result" }),
    null,
    "a preposition round with a mode",
  );

  const valid: Record<string, PracticeRound> = {
    "three misses at 0 ms": round(0, question("在", "把", "被", "对")),
    "a 40-character id": round(1000, { ...question("在"), id: "a".repeat(40) }),
    "a 40-character noun": round(1000, {
      ...question("在"),
      noun: "名".repeat(40),
    }),
    "a prompt of 100 code points": round(1000, {
      ...question("在"),
      prompt: "𠮷".repeat(100),
    }),
    "a space as the answer": round(1000, question(" ")),
  };
  for (const [name, r] of Object.entries(valid)) {
    assert.ok(preposition(r), `preposition: ${name}`);
    assert.ok(complement(r), `complement: ${name}`);
  }
  assert.equal(
    preposition(round(1000, { ...question("在"), noun: "名".repeat(41) })),
    null,
  );
  assert.equal(
    complement(round(1000, { ...question("在"), noun: "名".repeat(41) })),
    null,
  );

  assert.ok(preposition(round(1000, question("在".repeat(10)))));
  assert.equal(preposition(round(1000, question("在".repeat(11)))), null);
  assert.equal(preposition(round(1000, question("在", "把".repeat(11)))), null);
  assert.ok(complement(round(1000, question("完".repeat(40)))));
  assert.equal(complement(round(1000, question("完".repeat(41)))), null);
  assert.ok(complement(round(1000, question("完", "好".repeat(40)))));
  assert.equal(complement(round(1000, question("完", "好".repeat(41)))), null);
});

test("every complement mode is accepted", () => {
  for (const mode of [
    "result",
    "potential",
    "degree",
    "direction-simple",
    "direction-compound",
    "direction-simple-extended",
    "direction-compound-extended",
    "verb",
    "measure",
    "aspect",
  ]) {
    assert.equal(complement(round(1000, question("来")), mode)?.mode, mode);
  }
});

test("a preposition round accepts an undefined mode and refuses a defined one", () => {
  const valid = round(1000, question("在"));
  assert.ok(preposition({ ...valid, mode: undefined }));
  assert.equal(preposition({ ...valid, mode: "result" }), null);
  assert.equal(preposition({ ...valid, mode: null }), null);
});

test("the saved round counts from its questions", () => {
  const questions: ChoiceAnswer[] = [
    question("在"),
    question("在", "把", "被"),
    question("在"),
    question("在", "对"),
  ];
  const before = structuredClone(questions);
  const checked = complement(round(83_250, ...questions));
  assert.ok(checked);
  assert.equal(checked.questionCount, 4);
  assert.equal(checked.firstTryCount, 2);
  assert.equal(checked.missCount, 3);
  assert.equal(checked.elapsedMs, 83_250);
  assert.equal(checked.id, ROUND_ID);
  assert.equal(checked.mode, "result");
  assert.deepEqual(checked.startedAt, new Date("2026-10-20T11:58:00.000Z"));
  assert.deepEqual(checked.questions, before);

  checked.questions[1].misses.push("向");
  assert.deepEqual(questions, before, "the caller's questions changed");
});

test("a question without an id is saved without one", () => {
  const noId = question("在");
  assert.equal("id" in noId, false);
  const checked = preposition(
    round(1000, { ...question("在"), id: "" }, noId, {
      ...question("在"),
      id: "q-1",
    }),
  );
  assert.ok(checked);
  assert.equal("id" in checked.questions[0], false);
  assert.equal("id" in checked.questions[1], false);
  assert.equal(checked.questions[2].id, "q-1");
});

test("missed questions with an id become review targets", () => {
  const missed = {
    id: "P001",
    answer: "在",
    noun: "学校",
    prompt: "（　）学校学习",
    misses: ["把"],
  };
  const right = {
    id: "P002",
    answer: "在",
    noun: "北京",
    prompt: "（　）北京工作",
    misses: [],
  };
  const noId = {
    answer: "把",
    noun: "门",
    prompt: "（　）门关上",
    misses: ["被"],
  };
  assert.deepEqual(
    practiceReviewTargets("preposition", [missed, right, noId]),
    [{ language: "zh", kind: "preposition", targetId: "P001:学校" }],
  );

  const c = (id: string) => ({
    id,
    answer: "完",
    noun: "結果補語",
    prompt: "写（　）",
    misses: ["好"],
  });
  assert.deepEqual(practiceReviewTargets("complement", [c("result-01")]), [
    { language: "zh", kind: "complement", targetId: "result-01" },
  ]);
  assert.deepEqual(
    practiceReviewTargets("complement", [
      c("verb:C005:看"),
      c("measure-07"),
      c("result-01"),
      c("aspect-12"),
      c("measure-07"),
    ]),
    ["aspect-12", "measure-07", "result-01", "verb:C005:看"].map(
      (targetId) => ({ language: "zh", kind: "complement", targetId }),
    ),
  );
  assert.deepEqual(
    practiceReviewTargets("preposition", [
      { ...missed, id: "P009" },
      missed,
      { ...missed },
    ]),
    [
      { language: "zh", kind: "preposition", targetId: "P001:学校" },
      { language: "zh", kind: "preposition", targetId: "P009:学校" },
    ],
  );
});

test("choiceAnswersFrom reads rows saved before questions had ids", () => {
  const saved = choiceAnswersFrom(
    JSON.parse(
      `[{"answer":"在","noun":"学校","prompt":"（　）学校学习","misses":["把"]}]`,
    ),
  );
  assert.deepEqual(saved, [
    { answer: "在", noun: "学校", prompt: "（　）学校学习", misses: ["把"] },
  ]);
  assert.equal("id" in saved[0], false);

  assert.deepEqual(
    choiceAnswersFrom([
      { id: "P001", answer: "在", noun: "学校", prompt: "p" },
      { id: "", answer: "在", noun: "学校", prompt: "p", misses: null },
    ]),
    [
      { id: "P001", answer: "在", noun: "学校", prompt: "p", misses: [] },
      { answer: "在", noun: "学校", prompt: "p", misses: [] },
    ],
  );
});
