import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import {
  QuestionForbiddenError,
  type SaveQuestionResult,
} from "../src/application/chat/question-notes";
import type { SaveQuestionInput } from "../src/domain/chat/question";
import { handleQuestionSave } from "../src/presentation/controllers/question-save-controller";
import { accountForbiddenMessage } from "../src/presentation/presenters/account-action-errors";
import { genericErrorMessage } from "../src/presentation/presenters/generic-error-message";

const id = "0b7e3f5a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const input = { id, question: " 了 の使い方 ", answer: "完了を表します。" };
const badShape = { ok: false, message: "質問ノートの形式が不正です。" };
const forbidden = { ok: false, message: accountForbiddenMessage };
const generic = { ok: false, message: genericErrorMessage };
const member = async () => ({ role: "member" as const });
const never = async (): Promise<never> =>
  assert.fail("save must not be called");

function captureErrors(t: TestContext) {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  return logged;
}

test("a save without permission is not allowed", async () => {
  for (const getViewer of [
    async () => null,
    async () => ({ role: "guest" as const }),
    async () => ({ role: "revoked" as const }),
  ])
    assert.deepEqual(
      await handleQuestionSave(input, { getViewer, save: never }),
      forbidden,
    );
});

test("a note of the wrong shape is refused", async () => {
  for (const bad of [
    { ...input, id: id.toUpperCase() },
    { ...input, id: "question" },
    { ...input, answer: "" },
    { ...input, answer: "   " },
    { ...input, question: "好".repeat(4001) },
    { ...input, answer: "好".repeat(20_001) },
    { id, question: "了" },
    null,
  ])
    assert.deepEqual(
      await handleQuestionSave(bad, { getViewer: member, save: never }),
      badShape,
    );
});

test("each save result has its message", async (t) => {
  const logged = captureErrors(t);
  const saves: SaveQuestionInput[] = [];
  const run = (result: SaveQuestionResult) =>
    handleQuestionSave(input, {
      getViewer: member,
      save: async (note) => {
        saves.push(note);
        return result;
      },
    });
  assert.deepEqual(await run("saved"), { ok: true });
  assert.deepEqual(await run("invalid"), badShape);
  assert.deepEqual(await run("conflict"), generic);
  assert.deepEqual(await run("unavailable"), generic);
  assert.deepEqual(saves[0], {
    id,
    question: "了 の使い方",
    answer: "完了を表します。",
  });
  assert.deepEqual(logged, [
    ["QUESTION_SAVE_FAILED", "conflict"],
    ["QUESTION_SAVE_FAILED", "unavailable"],
  ]);
});

test("a failed save logs its code and the error's name only", async (t) => {
  const logged = captureErrors(t);
  assert.deepEqual(
    await handleQuestionSave(input, {
      getViewer: member,
      save: async () => {
        throw new QuestionForbiddenError();
      },
    }),
    forbidden,
  );
  assert.deepEqual(
    await handleQuestionSave(input, {
      getViewer: member,
      save: async () => {
        throw new Error("the answer text");
      },
    }),
    generic,
  );
  assert.deepEqual(logged, [["QUESTION_SAVE_FAILED", "Error"]]);
});
