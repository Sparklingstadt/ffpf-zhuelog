import assert from "node:assert/strict";
import { test } from "node:test";

import { handleLearningCsvImport } from "../src/presentation/controllers/learning-csv-import-controller";

type Dependencies = Parameters<typeof handleLearningCsvImport>[1];

function csvForm(user?: string) {
  const formData = new FormData();
  formData.set(
    "csvFile",
    new File(
      ["最初の文,添削後の文,ピン音\n我好,我很好,wo hen hao"],
      "notes.csv",
      {
        type: "text/csv",
      },
    ),
  );
  // A crafted request may carry `user`; the import must ignore it.
  if (user) formData.set("user", user);
  return formData;
}

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    getMember: async () => ({ githubId: "219588180" }),
    importCsv: { execute: async () => 1 },
    ...overrides,
  };
}

test("CSV import always saves into the signed-in user's own notes", async () => {
  const calls: string[][] = [];
  const state = await handleLearningCsvImport(
    csvForm("password:ckabc123"),
    dependencies({
      importCsv: {
        execute: async (ownerId, fileName) => {
          calls.push([ownerId, fileName]);
          return 1;
        },
      },
    }),
  );
  assert.deepEqual(state, {
    status: "success",
    message: "1件の学習文を登録しました。",
  });
  assert.deepEqual(calls, [["219588180", "notes.csv"]]);
});

test("CSV import asks a session without an owner ID to sign in again", async () => {
  let imported = false;
  const state = await handleLearningCsvImport(
    csvForm(),
    dependencies({
      getMember: async () => ({}),
      importCsv: {
        execute: async () => {
          imported = true;
          return 1;
        },
      },
    }),
  );
  assert.deepEqual(state, {
    status: "error",
    message: "一度ログアウトしてログインし直してください。",
  });
  assert.equal(imported, false);
});

test("CSV import rejects users who are not admins or members", async () => {
  const state = await handleLearningCsvImport(
    csvForm(),
    dependencies({ getMember: async () => null }),
  );
  assert.deepEqual(state, {
    status: "error",
    message: "この操作を行う権限がありません。再度ログインしてください。",
  });
});

// The Go API on Vercel cannot take request bodies over 4.5 MB, so the web
// keeps the same 4 MiB limit.
test("CSV import accepts exactly 4 MiB and rejects anything larger", async () => {
  const sized = (size: number) => {
    const formData = new FormData();
    formData.set(
      "csvFile",
      new File([new Uint8Array(size)], "notes.csv", { type: "text/csv" }),
    );
    return formData;
  };
  const tooLarge = await handleLearningCsvImport(
    sized(4 * 1024 * 1024 + 1),
    dependencies(),
  );
  assert.deepEqual(tooLarge, {
    status: "error",
    message: "ファイルは4MB以下にしてください。",
  });
  const exact = await handleLearningCsvImport(
    sized(4 * 1024 * 1024),
    dependencies(),
  );
  assert.equal(exact.status, "success");
});
