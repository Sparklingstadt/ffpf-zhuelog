import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkQuestionNote,
  QUESTION_ID,
  QUESTION_LIST_LIMIT,
  quickQuestionText,
} from "../src/domain/chat/question";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function one(text: unknown, role: unknown = "user") {
  return { messages: [{ role, text }] };
}

test("a quick question is checked as Go checked it", () => {
  const refused: [string, unknown][] = [
    ["no messages", { messages: [] }],
    ["one assistant", { messages: [{ role: "assistant", text: "答え" }] }],
    [
      "user, assistant, user",
      {
        messages: [
          { role: "user", text: "一" },
          { role: "assistant", text: "答え" },
          { role: "user", text: "二" },
        ],
      },
    ],
    ["4001 chars", one("字".repeat(4001))],
    ["blank text", one(" \n")],
    ["system role", one("x", "system")],
    ["messages missing", {}],
    ["messages null", { messages: null }],
    ["messages not an array", { messages: { role: "user", text: "x" } }],
    ["text a number", one(1)],
    ["text missing", { messages: [{ role: "user" }] }],
    ["unknown top-level key", { ...one("你好"), extra: 1 }],
    ["unknown message key", { messages: [{ role: "user", text: "x", id: 1 }] }],
    ["body an array", [one("你好")]],
    ["body a string", "你好"],
    ["body null", null],
  ];
  for (const [name, body] of refused) {
    assert.equal(quickQuestionText(body), null, name);
  }

  assert.equal(quickQuestionText(one("你好")), "你好");
  assert.equal(quickQuestionText(one("字".repeat(4000))), "字".repeat(4000));
  // Counted in code points like Go's runes: "𠮷" is two UTF-16 units.
  assert.equal(quickQuestionText(one("𠮷".repeat(4000))), "𠮷".repeat(4000));
  // Sent as written, not trimmed.
  assert.equal(quickQuestionText(one("  了？ ")), "  了？ ");
});

test("a question note is trimmed and bounded as Go did", () => {
  assert.deepEqual(
    checkQuestionNote({
      id: ID,
      question: " 了と过？ ",
      answer: " 違いです。 ",
    }),
    { id: ID, question: "了と过？", answer: "違いです。" },
  );

  const refused: [string, { id: string; question: string; answer: string }][] =
    [
      ["empty answer", { id: ID, question: "x", answer: "" }],
      ["blank answer", { id: ID, question: "x", answer: " \n\t" }],
      ["blank question", { id: ID, question: "  ", answer: "x" }],
      ["20001 answer", { id: ID, question: "x", answer: "字".repeat(20_001) }],
      ["4001 question", { id: ID, question: "字".repeat(4001), answer: "x" }],
      ["upper-case id", { id: ID.toUpperCase(), question: "x", answer: "x" }],
      ["not a uuid", { id: "not-a-uuid", question: "x", answer: "x" }],
    ];
  for (const [name, input] of refused) {
    assert.equal(checkQuestionNote(input), null, name);
  }

  for (const input of [
    { id: ID, question: "字".repeat(4000), answer: "字".repeat(20_000) },
    { id: ID, question: "𠮷".repeat(4000), answer: "x" },
  ]) {
    assert.deepEqual(checkQuestionNote(input), input);
  }
});

test("the list limit and id shape match Go", () => {
  assert.equal(QUESTION_LIST_LIMIT, 100);
  assert.ok(QUESTION_ID.test(ID));
  assert.ok(!QUESTION_ID.test(`${ID}0`));
});
