import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { ReviewForbiddenError } from "../src/application/review/review-queue";
import { handleReviewAnswer } from "../src/presentation/controllers/review-answer-controller";
import { accountForbiddenMessage } from "../src/presentation/presenters/account-action-errors";
import { genericErrorMessage } from "../src/presentation/presenters/generic-error-message";

const itemId = "cabcdefghijklmnopqrstuvwx";
const logId = "0b7e3f5a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const input = { itemId, logId, rating: 3 } as const;
const badShape = { ok: false, message: "復習の回答の形式が不正です。" };
const forbidden = { ok: false, message: accountForbiddenMessage };

function captureErrors(t: TestContext) {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  return logged;
}

const member = async () => ({ role: "member" as const });

test("members and admins answer with the parsed input", async () => {
  for (const role of ["member", "admin"] as const) {
    const answers: unknown[] = [];
    assert.deepEqual(
      await handleReviewAnswer(input, {
        getViewer: async () => ({ role }),
        answer: async (answer) => {
          answers.push(answer);
          return true;
        },
      }),
      { ok: true },
    );
    assert.deepEqual(answers, [input]);
  }
});

test("an answer without permission is not allowed", async () => {
  const never = async () => assert.fail("answer must not be called");
  for (const getViewer of [
    async () => null,
    async () => ({ role: "guest" as const }),
    async () => ({ role: "revoked" as const }),
  ])
    assert.deepEqual(
      await handleReviewAnswer(input, { getViewer, answer: never }),
      forbidden,
    );
});

test("an answer of the wrong shape is refused", async () => {
  const never = async () => assert.fail("answer must not be called");
  for (const bad of [
    // z.uuid() lets an upper-case id through; Go's pattern does not.
    { ...input, logId: logId.toUpperCase() },
    { ...input, logId: "{0b7e3f5a-1c2d-4e5f-8a9b-0c1d2e3f4a5b}" },
    { ...input, logId: "not-a-uuid" },
    { ...input, itemId: "" },
    { ...input, rating: 5 },
    null,
  ])
    assert.deepEqual(
      await handleReviewAnswer(bad, { getViewer: member, answer: never }),
      badShape,
    );
});

test("an item that is not in the queue is not found", async () => {
  assert.deepEqual(
    await handleReviewAnswer(input, {
      getViewer: member,
      answer: async () => false,
    }),
    { ok: false, message: "この問題は復習の一覧にありません。" },
  );
});

test("a refused queue is not allowed and other failures get the generic text", async (t) => {
  const logged = captureErrors(t);
  assert.deepEqual(
    await handleReviewAnswer(input, {
      getViewer: member,
      answer: async () => {
        throw new ReviewForbiddenError();
      },
    }),
    forbidden,
  );
  const failure = Object.assign(new Error("secret detail"), {
    name: "PrismaClientKnownRequestError",
  });
  assert.deepEqual(
    await handleReviewAnswer(input, {
      getViewer: member,
      answer: async () => {
        throw failure;
      },
    }),
    { ok: false, message: genericErrorMessage },
  );
  assert.deepEqual(logged, [
    ["REVIEW_ANSWER_FAILED", "PrismaClientKnownRequestError"],
  ]);
});
