import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  CheckedConversation,
  ConversationMessage,
} from "../src/domain/chat/conversation";
import {
  readConversationMessages,
  saveConversationSql,
} from "../src/infrastructure/prisma/conversation-store";

const ID = "0b6c3f2e-1d4a-4c8e-9f00-123456789abc";

function conversation(): CheckedConversation {
  return {
    id: ID,
    title: "旅行の会話",
    modelName: "gpt-test",
    ended: false,
    createdAt: new Date("2026-11-10T00:00:00.000Z"),
    messages: [
      { id: "m1", role: "user", text: "你好" },
      { id: "m2", role: "assistant", text: "你好！" },
    ],
  };
}

test("saveConversationSql updates only the owner's row and keeps createdAt", () => {
  const now = new Date("2026-11-16T09:00:00.000Z");
  const input = conversation();
  const sql = saveConversationSql("github:1", input, now);
  const text = sql.sql.replace(/\s+/g, " ");
  assert.ok(
    text.includes(
      'INSERT INTO "ChatConversation" ("id", "ownerId", "title", "modelName", "ended", "messages", "createdAt", "updatedAt")',
    ),
    text,
  );
  assert.ok(text.includes("::jsonb"), text);
  assert.ok(
    text.includes(
      'ON CONFLICT ("id") DO UPDATE SET "title" = EXCLUDED."title", "modelName" = EXCLUDED."modelName", "ended" = EXCLUDED."ended", "messages" = EXCLUDED."messages", "updatedAt" = EXCLUDED."updatedAt" WHERE "ChatConversation"."ownerId" = EXCLUDED."ownerId"',
    ),
    text,
  );
  const set = text.slice(text.indexOf("DO UPDATE SET"));
  assert.doesNotMatch(set.split("WHERE")[0], /"createdAt"/);
  assert.deepEqual(sql.values, [
    ID,
    "github:1",
    "旅行の会話",
    "gpt-test",
    false,
    JSON.stringify([
      { id: "m1", role: "user", text: "你好" },
      { id: "m2", role: "assistant", text: "你好！" },
    ]),
    input.createdAt,
    now,
  ]);
});

test("the saved messages are only id, role and text", () => {
  const input = conversation();
  input.messages = [
    { id: "m1", role: "user", text: "你好", extra: 1 } as ConversationMessage,
  ];
  const sql = saveConversationSql("github:1", input, new Date());
  assert.equal(sql.values[5], '[{"id":"m1","role":"user","text":"你好"}]');
});

test("readConversationMessages reads Go's rows and refuses others", () => {
  const rows = [
    { id: "m1", role: "user", text: "你好" },
    { id: "m2", role: "assistant", text: "你好！" },
  ];
  assert.deepEqual(readConversationMessages(rows), rows);
  assert.throws(() => readConversationMessages({ id: "m1" }));
  assert.throws(() =>
    readConversationMessages([{ id: "m1", role: "system", text: "x" }]),
  );
  assert.throws(() =>
    readConversationMessages([{ id: "m1", role: "user", text: 1 }]),
  );
  assert.throws(() => readConversationMessages([{ role: "user", text: "x" }]));
});
