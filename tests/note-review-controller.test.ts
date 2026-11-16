import assert from "node:assert/strict";
import { test } from "node:test";

import { LearningForbiddenError } from "../src/application/learning/learning-notes";
import { handleNoteReview } from "../src/presentation/controllers/note-review-controller";
import { genericErrorMessage } from "../src/presentation/presenters/generic-error-message";

const success = { status: "success", message: "" };
const unauthorized = { status: "error", message: "ログインし直してください。" };
const notFound = {
  status: "error",
  message: "見つかりませんでした。画面を更新してください。",
};

function form(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
}

test("members and admins put a note in and take it out", async () => {
  for (const role of ["member", "admin"] as const) {
    const runs: [string, boolean][] = [];
    const run = async (id: string, inReview: boolean) => {
      runs.push([id, inReview]);
      return true;
    };
    const getMember = async () => ({ role });
    assert.deepEqual(
      await handleNoteReview(form({ id: "cmabc123", inReview: "true" }), {
        getMember,
        run,
      }),
      success,
    );
    assert.deepEqual(
      await handleNoteReview(form({ id: "cmabc123", inReview: "false" }), {
        getMember,
        run,
      }),
      success,
    );
    assert.deepEqual(runs, [
      ["cmabc123", true],
      ["cmabc123", false],
    ]);
  }
});

test("guests and signed-out users are asked to sign in again", async () => {
  const run = async () => assert.fail("run must not be called");
  for (const getMember of [
    async () => null,
    async () => ({ role: "guest" as const }),
  ])
    assert.deepEqual(
      await handleNoteReview(form({ id: "cmabc123", inReview: "true" }), {
        getMember,
        run,
      }),
      unauthorized,
    );
});

test("a malformed form or a note that is not the user's is not found", async () => {
  const getMember = async () => ({ role: "member" as const });
  const never = async () => assert.fail("run must not be called");
  for (const fields of <Record<string, string>[]>[
    { id: "CM-bad", inReview: "true" },
    { id: "cmabc123", inReview: "yes" },
    { id: "cmabc123" },
  ])
    assert.deepEqual(
      await handleNoteReview(form(fields), { getMember, run: never }),
      notFound,
    );
  assert.deepEqual(
    await handleNoteReview(form({ id: "cmabc123", inReview: "true" }), {
      getMember,
      run: async () => false,
    }),
    notFound,
  );
});

test("LearningForbiddenError is not allowed and other errors go through the generic message", async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  const getMember = async () => ({ role: "member" as const });
  assert.deepEqual(
    await handleNoteReview(form({ id: "cmabc123", inReview: "true" }), {
      getMember,
      run: async () => {
        throw new LearningForbiddenError();
      },
    }),
    unauthorized,
  );
  const state = await handleNoteReview(
    form({ id: "cmabc123", inReview: "true" }),
    {
      getMember,
      run: async () => {
        throw new Error("db down");
      },
    },
  );
  assert.equal(state.status, "error");
  assert.equal(state.message, genericErrorMessage);
  assert.deepEqual(logged, [["NOTE_REVIEW_FAILED", "Error"]]);
});
