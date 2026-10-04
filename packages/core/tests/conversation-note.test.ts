import assert from "node:assert/strict";
import { test } from "node:test";

import { SaveConversationNote } from "@ffpf-zhuelog/core/application/conversation/use-cases/save-conversation-note";
import {
  ConversationNoteValidationError,
  MAX_CONVERSATION_MESSAGES,
  parseConversationNoteDraft,
  toConversationTitle,
} from "@ffpf-zhuelog/core/domain/conversation/conversation-note-draft";
import type {
  ConversationNoteDraft,
  ConversationNoteSummary,
} from "@ffpf-zhuelog/core/domain/conversation/entities/conversation-note";
import type { ConversationNoteRepository } from "@ffpf-zhuelog/core/domain/conversation/repositories/conversation-note-repository";

const chat = [
  { role: "user", text: "  我昨天去图书馆了。\n自然ですか？ " },
  { role: "assistant", text: "「我昨天去了图书馆。」のほうが自然です。" },
];

function fakeRepository(existingIds: string[] = []) {
  const calls: { method: "create" | "update"; id?: string }[] = [];
  const drafts: ConversationNoteDraft[] = [];
  const summary = (id: string, draft: ConversationNoteDraft) =>
    ({
      id,
      title: draft.title,
      createdAt: new Date("2026-10-04T00:00:00.000Z"),
      updatedAt: new Date("2026-10-04T00:00:00.000Z"),
      messageCount: draft.messages.length,
    }) satisfies ConversationNoteSummary;
  const unused = async (): Promise<never> => {
    throw new Error("unused repository method");
  };
  const repository: ConversationNoteRepository = {
    async create(draft) {
      calls.push({ method: "create" });
      drafts.push(draft);
      return summary("new-note", draft);
    },
    async update(id, draft) {
      calls.push({ method: "update", id });
      drafts.push(draft);
      return existingIds.includes(id) ? summary(id, draft) : null;
    },
    listCreatedAt: unused,
    listByDate: unused,
    getByDateAndNumber: unused,
  };
  return { repository, calls, drafts };
}

test("conversation drafts trim messages and use the first question as title", () => {
  const draft = parseConversationNoteDraft(chat);
  assert.equal(draft.title, "我昨天去图书馆了。 自然ですか？");
  assert.deepEqual(draft.messages, [
    { role: "user", text: "我昨天去图书馆了。\n自然ですか？" },
    { role: "assistant", text: "「我昨天去了图书馆。」のほうが自然です。" },
  ]);
});

test("conversation titles are truncated by code point", () => {
  assert.equal(toConversationTitle("𠮷".repeat(41)), `${"𠮷".repeat(40)}…`);
  assert.equal(toConversationTitle("短い"), "短い");
});

test("conversation drafts reject invalid or incomplete chats", () => {
  for (const input of [
    null,
    "text",
    [{ role: "system", text: "x" }, ...chat],
    [{ role: "user", text: "   " }, chat[1]],
    [chat[0]],
    [chat[1]],
    Array.from(
      { length: MAX_CONVERSATION_MESSAGES + 1 },
      (_, index) => chat[index % 2],
    ),
    [chat[0], { role: "assistant", text: "长".repeat(100_000) }],
  ]) {
    assert.throws(
      () => parseConversationNoteDraft(input),
      ConversationNoteValidationError,
    );
  }
});

test("saving creates a note, then updates it with the continued chat", async () => {
  const { repository, calls, drafts } = fakeRepository(["saved-note"]);
  const save = new SaveConversationNote(repository);

  const created = await save.execute(chat);
  assert.equal(created.id, "new-note");
  const continued = [...chat, ...chat];
  const updated = await save.execute(continued, "saved-note");
  assert.equal(updated.id, "saved-note");
  assert.equal(updated.messageCount, 4);
  assert.deepEqual(calls, [
    { method: "create" },
    { method: "update", id: "saved-note" },
  ]);
  assert.equal(drafts[1].messages.length, 4);
});

test("saving falls back to a new note when the earlier note is gone", async () => {
  const { repository, calls } = fakeRepository();
  const note = await new SaveConversationNote(repository).execute(
    chat,
    "missing",
  );
  assert.equal(note.id, "new-note");
  assert.deepEqual(calls, [
    { method: "update", id: "missing" },
    { method: "create" },
  ]);
});

test("invalid chats never reach the repository", async () => {
  const { repository, calls } = fakeRepository();
  await assert.rejects(
    new SaveConversationNote(repository).execute([chat[0]]),
    ConversationNoteValidationError,
  );
  assert.deepEqual(calls, []);
});
