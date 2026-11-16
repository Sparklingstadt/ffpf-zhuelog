import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import {
  ConversationForbiddenError,
  type SaveConversationResult,
} from "../src/application/chat/conversation-notes";
import type { SaveConversationInput } from "../src/domain/chat/conversation";
import {
  actionSuccess,
  actionUnauthorized,
} from "../src/presentation/controllers/action-state";
import {
  handleConversationDelete,
  handleConversationSave,
} from "../src/presentation/controllers/conversation-controller";
import { accountForbiddenMessage } from "../src/presentation/presenters/account-action-errors";
import { genericErrorMessage } from "../src/presentation/presenters/generic-error-message";

const id = "0b7e3f5a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const input: SaveConversationInput = {
  id,
  title: "你好",
  modelName: "gpt-test",
  ended: false,
  createdAt: "2026-11-15T01:02:03.000Z",
  messages: [
    { id: "m1", role: "user", text: "你好" },
    { id: "m2", role: "assistant", text: "你好！" },
  ],
};
const shapeMessage = "会話の形式または上限を確認してください。";
const badShape = { ok: false, message: shapeMessage };
const forbidden = { ok: false, message: accountForbiddenMessage };
const generic = { ok: false, message: genericErrorMessage };
const member = async () => ({ role: "member" as const });
const never = async (): Promise<never> =>
  assert.fail("the store must not be called");

function captureErrors(t: TestContext) {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  return logged;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

test("a conversation save without permission is not allowed", async () => {
  for (const getViewer of [
    async () => null,
    async () => ({ role: "guest" as const }),
  ])
    assert.deepEqual(
      await handleConversationSave(input, { getViewer, save: never }),
      forbidden,
    );
});

test("a conversation of the wrong shape is refused", async () => {
  for (const bad of [
    { ...input, id: id.toUpperCase() },
    { ...input, createdAt: "yesterday" },
    { ...input, ended: "false" },
    null,
  ])
    assert.deepEqual(
      await handleConversationSave(bad, { getViewer: member, save: never }),
      badShape,
    );
});

test("each conversation save result has its message", async (t) => {
  const logged = captureErrors(t);
  const saves: SaveConversationInput[] = [];
  const run = (result: SaveConversationResult) =>
    handleConversationSave(input, {
      getViewer: member,
      save: async (conversation) => {
        saves.push(conversation);
        return result;
      },
    });
  assert.deepEqual(await run("saved"), { ok: true });
  assert.deepEqual(await run("invalid"), badShape);
  assert.deepEqual(await run("conflict"), generic);
  assert.deepEqual(await run("unavailable"), generic);
  assert.deepEqual(saves[0], input);
  assert.deepEqual(logged, [
    ["CONVERSATION_SAVE_FAILED", "conflict"],
    ["CONVERSATION_SAVE_FAILED", "unavailable"],
  ]);
});

test("a failed conversation save logs its code and the error's name only", async (t) => {
  const logged = captureErrors(t);
  assert.deepEqual(
    await handleConversationSave(input, {
      getViewer: member,
      save: async () => {
        throw new ConversationForbiddenError();
      },
    }),
    forbidden,
  );
  assert.deepEqual(
    await handleConversationSave(input, {
      getViewer: member,
      save: async () => {
        throw new Error("the conversation text");
      },
    }),
    generic,
  );
  assert.deepEqual(logged, [["CONVERSATION_SAVE_FAILED", "Error"]]);
});

test("a conversation delete checks permission, the id and the result", async (t) => {
  const logged = captureErrors(t);
  for (const getViewer of [
    async () => null,
    async () => ({ role: "guest" as const }),
  ])
    assert.deepEqual(
      await handleConversationDelete(form({ id }), {
        getViewer,
        remove: never,
      }),
      actionUnauthorized,
    );
  assert.deepEqual(
    await handleConversationDelete(form({ id: "conversation" }), {
      getViewer: member,
      remove: never,
    }),
    { status: "error", message: shapeMessage },
  );

  const removed: string[] = [];
  assert.deepEqual(
    await handleConversationDelete(form({ id }), {
      getViewer: member,
      remove: async (conversationId) => {
        removed.push(conversationId);
        return false;
      },
    }),
    { status: "error", message: genericErrorMessage },
  );
  assert.deepEqual(
    await handleConversationDelete(form({ id }), {
      getViewer: member,
      remove: async (conversationId) => {
        removed.push(conversationId);
        return true;
      },
    }),
    actionSuccess,
  );
  assert.deepEqual(removed, [id, id]);
  assert.deepEqual(logged, [["CONVERSATION_DELETE_FAILED", "not-found"]]);
});

test("a conversation delete the owner may not make is unauthorized", async () => {
  assert.deepEqual(
    await handleConversationDelete(form({ id }), {
      getViewer: member,
      remove: async () => {
        throw new ConversationForbiddenError();
      },
    }),
    actionUnauthorized,
  );
});
