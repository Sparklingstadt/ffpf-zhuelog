import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { PracticeForbiddenError } from "../src/application/practice/practice-records";
import {
  complementRoundInput,
  handlePracticeRoundSave,
  prepositionRoundInput,
} from "../src/presentation/controllers/practice-round-controller";
import { accountForbiddenMessage } from "../src/presentation/presenters/account-action-errors";
import { genericErrorMessage } from "../src/presentation/presenters/generic-error-message";

const code = "PREPOSITION_RECORD_SAVE_FAILED";
const id = "0b7e3f5a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const input = {
  id,
  startedAt: "2026-11-16T02:55:00.000Z",
  elapsedMs: 300_000,
  questions: [
    {
      id: "P001",
      answer: "在",
      noun: "学校",
      prompt: "（　）学校",
      misses: [],
    },
  ],
};
const badShape = { ok: false, message: "練習の記録の形式が不正です。" };
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
      await handlePracticeRoundSave(input, {
        schema: prepositionRoundInput,
        code,
        getViewer,
        save: never,
      }),
      forbidden,
    );
});

test("a round of the wrong shape is refused", async () => {
  for (const bad of [
    { ...input, id: id.toUpperCase() },
    { ...input, id: "not-a-uuid" },
    { ...input, questions: "P001" },
    { ...input, elapsedMs: 1.5 },
    { ...input, startedAt: "yesterday" },
    null,
  ])
    assert.deepEqual(
      await handlePracticeRoundSave(bad, {
        schema: prepositionRoundInput,
        code,
        getViewer: member,
        save: never,
      }),
      badShape,
    );
  assert.deepEqual(
    await handlePracticeRoundSave(
      { ...input, mode: "nope" },
      {
        schema: complementRoundInput,
        code: "COMPLEMENT_RECORD_SAVE_FAILED",
        getViewer: member,
        save: never,
      },
    ),
    badShape,
  );
});

test("a round the check refuses is invalid", async () => {
  assert.deepEqual(
    await handlePracticeRoundSave(input, {
      schema: prepositionRoundInput,
      code,
      getViewer: member,
      save: async () => "invalid",
    }),
    badShape,
  );
});

test("an id taken by someone else shows the generic message", async (t) => {
  const logged = captureErrors(t);
  assert.deepEqual(
    await handlePracticeRoundSave(input, {
      schema: prepositionRoundInput,
      code,
      getViewer: member,
      save: async () => "taken",
    }),
    generic,
  );
  assert.deepEqual(logged, [[code, "taken"]]);
});

test("a refused owner is not allowed and other failures get the generic text", async (t) => {
  const logged = captureErrors(t);
  assert.deepEqual(
    await handlePracticeRoundSave(input, {
      schema: prepositionRoundInput,
      code,
      getViewer: member,
      save: async () => {
        throw new PracticeForbiddenError();
      },
    }),
    forbidden,
  );
  const failure = Object.assign(new Error("secret detail"), {
    name: "PrismaClientKnownRequestError",
  });
  assert.deepEqual(
    await handlePracticeRoundSave(input, {
      schema: prepositionRoundInput,
      code,
      getViewer: member,
      save: async () => {
        throw failure;
      },
    }),
    generic,
  );
  assert.deepEqual(logged, [[code, "PrismaClientKnownRequestError"]]);
});

test("a saved round is ok and is passed with a Date", async () => {
  for (const role of ["member", "admin"] as const) {
    const saves: unknown[] = [];
    assert.deepEqual(
      await handlePracticeRoundSave(
        // Unknown keys are dropped; absent and null misses are none.
        {
          ...input,
          extra: 1,
          questions: [
            { answer: "在", noun: "学校", prompt: "（　）学校" },
            { answer: "给", noun: "妈妈", prompt: "（　）妈妈", misses: null },
          ],
        },
        {
          schema: prepositionRoundInput,
          code,
          getViewer: async () => ({ role }),
          save: async (round) => {
            saves.push(round);
            return "saved";
          },
        },
      ),
      { ok: true },
    );
    assert.deepEqual(saves, [
      {
        id,
        startedAt: new Date("2026-11-16T02:55:00.000Z"),
        elapsedMs: 300_000,
        questions: [
          { answer: "在", noun: "学校", prompt: "（　）学校", misses: [] },
          { answer: "给", noun: "妈妈", prompt: "（　）妈妈", misses: [] },
        ],
      },
    ]);
  }
  const saves: unknown[] = [];
  await handlePracticeRoundSave(
    { ...input, mode: "aspect" },
    {
      schema: complementRoundInput,
      code: "COMPLEMENT_RECORD_SAVE_FAILED",
      getViewer: member,
      save: async (round) => {
        saves.push(round);
        return "saved";
      },
    },
  );
  assert.equal((saves[0] as { mode: string }).mode, "aspect");
});
