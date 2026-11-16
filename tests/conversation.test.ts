import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ChatTurn,
  chatTurns,
  checkConversation,
  conversationTitle,
  fitsLimits,
  MAX_MESSAGES,
  MAX_TOTAL_CHARS,
  type SaveConversationInput,
} from "../src/domain/chat/conversation";

test("conversationTitle squeezes spaces, cuts at 80, falls back", () => {
  assert.equal(conversationTitle("  你好\n  世界 "), "你好 世界");
  assert.equal(conversationTitle("字".repeat(100)), "字".repeat(80));
  assert.equal(conversationTitle(" \n "), "新しい会話");
});

test("fitsLimits counts 40 messages and 40000 chars", () => {
  const texts = (n: number, text = "a") =>
    Array.from({ length: n }, () => ({ text }));
  assert.equal(fitsLimits(texts(MAX_MESSAGES)), true);
  assert.equal(fitsLimits(texts(MAX_MESSAGES + 1)), false);
  assert.equal(fitsLimits([{ text: "字".repeat(MAX_TOTAL_CHARS) }]), true);
  assert.equal(
    fitsLimits([{ text: "字".repeat(MAX_TOTAL_CHARS) }, { text: "a" }]),
    false,
  );
  // Characters, not UTF-16 units: an astral character counts once.
  assert.equal(fitsLimits([{ text: "𠀋".repeat(MAX_TOTAL_CHARS) }]), true);
});

test("chat messages are checked as Go checked them", () => {
  // Go: chat/chat_test.go TestValidate, plus the shape decodeBody refused.
  const user = (text: string): ChatTurn => ({ role: "user", text });
  const assistant = (text: string): ChatTurn => ({ role: "assistant", text });
  const alternating = (n: number): ChatTurn[] =>
    Array.from({ length: n }, (_, i) =>
      i % 2 === 0 ? user("你") : assistant("好"),
    );
  const forty = [...alternating(39), user("你")];

  const refused: [string, unknown][] = [
    ["none", { messages: [] }],
    ["forty-one", { messages: [...alternating(40), user("你")] }],
    ["last is assistant", { messages: [user("你好"), assistant("你好！")] }],
    [
      "system role",
      { messages: [{ role: "system", text: "x" }, user("你好")] },
    ],
    ["blank text", { messages: [user(" \n\t")] }],
    [
      "40001 chars",
      {
        messages: [
          user("字".repeat(MAX_TOTAL_CHARS - 1)),
          assistant("好"),
          user("你"),
        ],
      },
    ],
    ["no messages", {}],
    ["null messages", { messages: null }],
    ["messages not an array", { messages: { role: "user", text: "你" } }],
    ["text a number", { messages: [{ role: "user", text: 1 }] }],
    ["unknown top-level key", { messages: [user("你")], extra: 1 }],
    [
      "unknown message key",
      { messages: [{ role: "user", text: "你", id: "m1" }] },
    ],
    ["body an array", [user("你")]],
    ["body a string", "你好"],
  ];
  for (const [name, body] of refused) {
    assert.equal(chatTurns(body), null, name);
  }

  const accepted: [string, ChatTurn[]][] = [
    ["one user", [user("你好")]],
    ["forty ending with user", forty],
    ["40000 chars", [user("字".repeat(MAX_TOTAL_CHARS))]],
    // Code points, not UTF-16 units: s.length would count 80 000.
    ["40000 astral chars", [user("𠮷".repeat(MAX_TOTAL_CHARS))]],
  ];
  for (const [name, messages] of accepted) {
    assert.deepEqual(chatTurns({ messages }), messages, name);
  }
  // Sent to OpenAI as written: not trimmed.
  assert.deepEqual(chatTurns({ messages: [user("  再见 ")] }), [
    user("  再见 "),
  ]);
});

const conversationId = "3f2b8a64-5c1d-4e7f-9a0b-1c2d3e4f5a6b";

function saved(
  change: Partial<SaveConversationInput> = {},
): SaveConversationInput {
  return {
    id: conversationId,
    title: "你好",
    modelName: "gpt-test",
    ended: false,
    createdAt: "2026-10-20T11:00:00.000Z",
    messages: [
      { id: "m1", role: "user", text: "你好" },
      { id: "m2", role: "assistant", text: "你好！" },
    ],
    ...change,
  };
}

test("a saved conversation is checked as Go checked it", () => {
  // Go: httpapi/chat_handlers_test.go TestConversationCRUD.
  assert.deepEqual(checkConversation(saved()), {
    id: conversationId,
    title: "你好",
    modelName: "gpt-test",
    ended: false,
    createdAt: new Date("2026-10-20T11:00:00.000Z"),
    messages: [
      { id: "m1", role: "user", text: "你好" },
      { id: "m2", role: "assistant", text: "你好！" },
    ],
  });

  const base = saved().messages;
  const refused: [string, SaveConversationInput][] = [
    ["long title", saved({ title: "字".repeat(101) })],
    ["empty title", saved({ title: " " })],
    ["dup ids", saved({ messages: [base[0], { ...base[1], id: "m1" }] })],
    ["bad date", saved({ createdAt: "yesterday" })],
    [
      "bad role",
      saved({
        messages: [base[0], { ...base[1], role: "system" as "assistant" }],
      }),
    ],
    ["no messages", saved({ messages: [] })],
    ["blank text", saved({ messages: [base[0], { ...base[1], text: "  " }] })],
    ["long model", saved({ modelName: "m".repeat(151) })],
    ["empty model", saved({ modelName: "" })],
    ["empty message id", saved({ messages: [{ ...base[0], id: "" }] })],
    [
      "long message id",
      saved({ messages: [{ ...base[0], id: "i".repeat(201) }] }),
    ],
    [
      "forty-one",
      saved({
        messages: Array.from({ length: MAX_MESSAGES + 1 }, (_, i) => ({
          id: `m${i}`,
          role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
          text: "你",
        })),
      }),
    ],
    ["upper-case id", saved({ id: conversationId.toUpperCase() })],
    ["not a uuid", saved({ id: "not-a-uuid" })],
  ];
  for (const [name, input] of refused) {
    assert.equal(checkConversation(input), null, name);
  }

  assert.equal(checkConversation(saved({ title: " 你好 " }))?.title, "你好");
  const accepted: [string, SaveConversationInput][] = [
    ["100-char title", saved({ title: "字".repeat(100) })],
    ["150-char model", saved({ modelName: "m".repeat(150) })],
    [
      "200-char message id",
      saved({ messages: [{ ...base[0], id: "i".repeat(200) }] }),
    ],
  ];
  for (const [name, input] of accepted) {
    assert.notEqual(checkConversation(input), null, name);
  }

  // Go: TestConversationPutAllowsTheLastAnswerOverTheLimit. The answer that
  // takes a conversation over the limit may still be saved.
  const pair = (question: string, answer: string) =>
    saved({
      ended: true,
      messages: [
        { id: "m1", role: "user", text: question },
        { id: "m2", role: "assistant", text: answer },
      ],
    });
  assert.notEqual(
    checkConversation(pair("字".repeat(MAX_TOTAL_CHARS), "答".repeat(1500))),
    null,
  );
  // Without the answer the conversation must still fit.
  assert.equal(
    checkConversation(pair("字".repeat(MAX_TOTAL_CHARS + 1), "答")),
    null,
  );
  // An answer longer than any OpenAI answer can be is refused.
  assert.equal(checkConversation(pair("你好", "答".repeat(20_001))), null);
  // A conversation ending with the user's turn gets no allowance.
  assert.equal(
    checkConversation(
      saved({
        messages: [
          { id: "m1", role: "user", text: "字".repeat(MAX_TOTAL_CHARS + 1) },
        ],
      }),
    ),
    null,
  );
});
