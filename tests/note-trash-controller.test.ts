import assert from "node:assert/strict";
import { test } from "node:test";

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
  const calls: [string, string][] = [];
  return {
    calls,
    run: async (ownerId: string, id: string) => {
      calls.push([ownerId, id]);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const admin = async () => ({ githubId: "219588180" });

test("a note action uses the signed-in owner, never one from the form", async () => {
  const { calls, run } = recorder();
  const state = await handleNoteAction(
    form({ id: "cmabc123", ownerId: "42", user: "password:ckabc" }),
    { getMember: admin, run },
  );
  assert.deepEqual(state, { status: "success", message: "" });
  assert.deepEqual(calls, [["219588180", "cmabc123"]]);
});

test("a note action asks signed-out users and old sessions to sign in", async () => {
  for (const getMember of [async () => null, async () => ({})]) {
    const { calls, run } = recorder();
    const state = await handleNoteAction(form({ id: "cmabc123" }), {
      getMember,
      run,
    });
    assert.deepEqual(state, unauthorized);
    assert.deepEqual(calls, []);
  }
});

test("a note action treats a malformed id as a missing note", async () => {
  for (const id of ["../x", "", "A".repeat(10)]) {
    const { calls, run } = recorder();
    const state = await handleNoteAction(form({ id }), {
      getMember: admin,
      run,
    });
    assert.deepEqual(state, notFound, id);
    assert.deepEqual(calls, []);
  }
  const { calls, run } = recorder();
  assert.deepEqual(
    await handleNoteAction(new FormData(), {
      getMember: admin,
      run,
    }),
    notFound,
  );
  assert.deepEqual(calls, []);
});

test("a note action reports a note the owner does not have", async () => {
  const { run } = recorder(false);
  assert.deepEqual(
    await handleNoteAction(form({ id: "cmabc123" }), {
      getMember: admin,
      run,
    }),
    notFound,
  );
});

test("a note action reports a database failure without details", async () => {
  const { run } = recorder(new Error("connection refused"));
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    assert.deepEqual(
      await handleNoteAction(form({ id: "cmabc123" }), {
        getMember: admin,
        run,
      }),
      failed,
    );
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, [["NOTE_TRASH_FAILED"]]);
});

test("emptying the trash uses the signed-in owner", async () => {
  const owners: string[] = [];
  const run = async (ownerId: string) => {
    owners.push(ownerId);
    return 4;
  };
  assert.deepEqual(await handleEmptyTrash({ getMember: admin, run }), {
    status: "success",
    message: "",
  });
  assert.deepEqual(owners, ["219588180"]);
  assert.deepEqual(
    await handleEmptyTrash({ getMember: async () => null, run }),
    unauthorized,
  );
  assert.deepEqual(owners, ["219588180"]);
});

test("emptying the trash reports a database failure", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(
      await handleEmptyTrash({
        getMember: admin,
        run: async () => {
          throw new Error("down");
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
