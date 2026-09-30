import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readConversationBackup,
  writeConversationBackup,
  conversationBackupKey,
} from "../src/infrastructure/chat/browser-conversation-history";
import { conversationMarkdown } from "../src/presentation/presenters/conversation-markdown";
const value = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "你好",
  modelName: "gpt-6.1-sol",
  ended: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  messages: [
    { id: "u1", role: "user" as const, text: "你好" },
    { id: "a1", role: "assistant" as const, text: "你好！" },
  ],
};
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, text: string) => {
      data.set(key, text);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
test("local snapshots restore current draft, evict old records, and isolate accounts", () => {
  const s = storage();
  let records = Array.from({ length: 25 }, (_, i) => ({
    ...value,
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  }));
  writeConversationBackup(s, "100", value.id, records);
  records = readConversationBackup(s, "100").conversations;
  assert.equal(records.length, 20);
  assert.equal(records[0].id, value.id);
  assert.deepEqual(records[0].messages, value.messages);
  assert.equal(readConversationBackup(s, "200").conversations.length, 0);
  assert.ok(
    new TextEncoder().encode(s.getItem(conversationBackupKey("100"))!).length <=
      1024 * 1024,
  );
});
test("corruption and quota errors are explicit and exports retain speakers", () => {
  const s = storage();
  s.setItem(conversationBackupKey("100"), "invalid");
  assert.throws(() => readConversationBackup(s, "100"));
  assert.throws(() =>
    writeConversationBackup(
      {
        ...s,
        setItem: () => {
          throw new Error("quota");
        },
      },
      "100",
      value.id,
      [value],
    ),
  );
  const text = conversationMarkdown(value);
  assert.ok(text.includes("## あなた"));
  assert.ok(text.includes("## ChatGPT"));
  assert.ok(text.includes("你好！"));
});

test("byte budget evicts oldest snapshots while retaining the active conversation and viewing state", () => {
  const s = storage();
  const records = Array.from({ length: 20 }, (_, i) => ({
    ...value,
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    messages: [{ id: "u1", role: "user" as const, text: "中".repeat(40000) }],
  }));
  const written = writeConversationBackup(
    s,
    "100",
    records[0].id,
    records,
    true,
  );
  assert.ok(written.length < 20);
  assert.equal(written[0].id, records[0].id);
  const read = readConversationBackup(s, "100");
  assert.equal(read.viewOnly, true);
  assert.ok(
    new TextEncoder().encode(s.getItem(conversationBackupKey("100"))!).length <=
      1024 * 1024,
  );
});

test("stale tabs merge other conversations and cannot replace newer archives", () => {
  const s = storage();
  const other = {
    ...value,
    id: "00000000-0000-4000-8000-000000000002",
    updatedAt: "2026-10-01T01:00:00.000Z",
    ended: true,
  };
  writeConversationBackup(s, "100", other.id, [other]);
  writeConversationBackup(s, "100", value.id, [
    value,
    { ...other, ended: false, updatedAt: value.updatedAt },
  ]);
  const records = readConversationBackup(s, "100").conversations;
  assert.equal(records.length, 2);
  assert.equal(records.find((item) => item.id === other.id)?.ended, true);
});

test("an over-limit archive cannot poison backups of a new conversation", () => {
  const s = storage();
  const invalid = {
    ...value,
    messages: Array.from({ length: 41 }, (_, i) => ({
      id: String(i),
      role: "user" as const,
      text: "hello",
    })),
  };
  const fresh = {
    ...value,
    id: "00000000-0000-4000-8000-000000000002",
    messages: [],
  };
  assert.throws(() => writeConversationBackup(s, "100", invalid.id, [invalid]));
  writeConversationBackup(s, "100", fresh.id, [fresh, invalid]);
  assert.deepEqual(readConversationBackup(s, "100").conversations, [fresh]);
});

test("a stale active draft cannot overwrite the same conversation updated by another tab", () => {
  const s = storage();
  const newer = {
    ...value,
    updatedAt: "2026-10-01T01:00:00.000Z",
    ended: true,
  };
  writeConversationBackup(s, "100", value.id, [newer]);
  writeConversationBackup(s, "100", value.id, [value]);
  assert.equal(readConversationBackup(s, "100").conversations[0].ended, true);
});
