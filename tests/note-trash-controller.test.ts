import assert from "node:assert/strict";
import { test } from "node:test";

import { LearningForbiddenError } from "../src/application/learning/learning-notes";
import {
  handleEmptyTrash,
  handleNoteAction,
} from "../src/presentation/controllers/note-trash-controller";
import { trashedRedirectPath } from "../src/presentation/presenters/note-trash-href";

const unauthorized = { status: "error", message: "ログインし直してください。" };
const notFound = {
  status: "error",
  message: "このノートは見つかりませんでした。画面を更新してください。",
};
const failed = {
  status: "error",
  message: "処理できませんでした。時間をおいてもう一度お試しください。",
};

function form(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
}

function recorder(result: boolean | Error = true) {
  const calls: string[] = [];
  return {
    calls,
    run: async (id: string) => {
      calls.push(id);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

test("a note action passes only the note id, never an owner from the form", async () => {
  const { calls, run } = recorder();
  const state = await handleNoteAction(
    form({ id: "cmabc123", ownerId: "42", user: "password:ckabc" }),
    { run },
  );
  assert.deepEqual(state, { status: "success", message: "" });
  assert.deepEqual(calls, ["cmabc123"]);
});

test("a note action asks users who may not act to sign in again", async () => {
  const { run } = recorder(new LearningForbiddenError());
  assert.deepEqual(
    await handleNoteAction(form({ id: "cmabc123" }), { run }),
    unauthorized,
  );
  assert.deepEqual(
    await handleEmptyTrash({
      run: async () => {
        throw new LearningForbiddenError();
      },
    }),
    unauthorized,
  );
});

test("a note action reports a database failure with the generic text, logging only its name", async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  const { run } = recorder(
    Object.assign(new Error("secret"), {
      name: "PrismaClientKnownRequestError",
    }),
  );
  assert.deepEqual(
    await handleNoteAction(form({ id: "cmabc123" }), { run }),
    failed,
  );
  assert.deepEqual(logged, [
    ["NOTE_TRASH_FAILED", "PrismaClientKnownRequestError"],
  ]);
});

test("a note action treats a malformed id as a missing note", async () => {
  for (const id of ["../x", "", "A".repeat(10)]) {
    const { calls, run } = recorder();
    const state = await handleNoteAction(form({ id }), { run });
    assert.deepEqual(state, notFound, id);
    assert.deepEqual(calls, []);
  }
  const { calls, run } = recorder();
  assert.deepEqual(await handleNoteAction(new FormData(), { run }), notFound);
  assert.deepEqual(calls, []);
});

test("a note action reports a note the owner does not have", async () => {
  const { run } = recorder(false);
  assert.deepEqual(
    await handleNoteAction(form({ id: "cmabc123" }), { run }),
    notFound,
  );
});

test("a note action reports a failure without details", async () => {
  const { run } = recorder(new Error("停止中です"));
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    assert.deepEqual(
      await handleNoteAction(form({ id: "cmabc123" }), { run }),
      failed,
    );
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, [["NOTE_TRASH_FAILED", "Error"]]);
});

test("a note action treats the application's refusal as not allowed", async () => {
  const forbidden = recorder(new LearningForbiddenError());
  assert.deepEqual(
    await handleNoteAction(form({ id: "cmabc123" }), { run: forbidden.run }),
    unauthorized,
  );
});

test("a note action lets Next's redirect through", async () => {
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
    digest: "NEXT_REDIRECT;replace;/signin;307;",
  });
  const { run } = recorder(redirect);
  await assert.rejects(
    handleNoteAction(form({ id: "cmabc123" }), { run }),
    (error) => error === redirect,
  );
  await assert.rejects(
    handleEmptyTrash({
      run: async () => {
        throw redirect;
      },
    }),
    (error) => error === redirect,
  );
});

test("emptying the trash succeeds however many notes it deleted", async () => {
  let runs = 0;
  const run = async () => {
    runs++;
    return 4;
  };
  assert.deepEqual(await handleEmptyTrash({ run }), {
    status: "success",
    message: "",
  });
  assert.equal(runs, 1);
});

test("emptying the trash reports a failure", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(
      await handleEmptyTrash({
        run: async () => {
          throw new Error("db");
        },
      }),
      failed,
    );
  } finally {
    console.error = original;
  }
});

test("after trashing, the user lands on that day's list", () => {
  assert.equal(
    trashedRedirectPath("/logs", form({ year: "2026", month: "10", day: "8" })),
    "/logs/2026/10/8?trashed=1",
  );
});

test("a tampered date sends the user to the date list instead", () => {
  for (const fields of [
    { year: "../x", month: "10", day: "8" } as Record<string, string>,
    { year: "2026", month: "13", day: "8" },
    { year: "2026", month: "10", day: "08" },
    { year: "2026", month: "2", day: "30" },
    {},
  ])
    assert.equal(trashedRedirectPath("/logs", form(fields)), "/logs");
});
