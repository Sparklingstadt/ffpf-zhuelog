import assert from "node:assert/strict";
import { test } from "node:test";

import type { Conversation } from "../src/domain/chat/conversation";
import {
  conversationMarkdownFileName,
  toConversationMarkdown,
} from "../src/presentation/presenters/conversation-markdown-export";

function conversation(messages: Conversation["messages"]): Conversation {
  return {
    id: "c1",
    title: "你好について",
    modelName: "gpt-5-mini",
    ended: false,
    // 2026-10-22 12:04 in Tokyo.
    createdAt: new Date("2026-10-22T03:04:05.000Z"),
    updatedAt: new Date("2026-10-22T03:10:00.000Z"),
    messages,
  };
}

test("writes the title, when and with which model, then each message in order", () => {
  const markdown = toConversationMarkdown(
    conversation([
      { id: "m1", role: "user", text: "你好は何？" },
      { id: "m2", role: "assistant", text: "挨拶です。\n\n- nǐ hǎo" },
    ]),
  );
  assert.equal(
    markdown,
    [
      "# 你好について",
      "",
      "- 日時: 2026/10/22 12:04",
      "- モデル: gpt-5-mini",
      "",
      "## あなた",
      "",
      "你好は何？",
      "",
      "## ChatGPT",
      "",
      "挨拶です。",
      "",
      "- nǐ hǎo",
      "",
    ].join("\n"),
  );
});

test("empty messages are left out, as on the page", () => {
  const markdown = toConversationMarkdown(
    conversation([
      { id: "m1", role: "user", text: "a" },
      { id: "m2", role: "assistant", text: "" },
    ]),
  );
  assert.ok(!markdown.includes("## ChatGPT"));
  assert.ok(markdown.endsWith("## あなた\n\na\n"));
});

test("the file name carries the conversation's date and number", () => {
  assert.equal(
    conversationMarkdownFileName({ year: 2026, month: 10, day: 2 }, 3),
    "huihua-2026-10-02-3.md",
  );
});
