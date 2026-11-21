import assert from "node:assert/strict";
import { test } from "node:test";

import { redirect } from "next/navigation";

import { LearningForbiddenError } from "../src/application/learning/learning-notes";
import { handleLearningCsvImport } from "../src/presentation/controllers/learning-csv-import-controller";

type Dependencies = Parameters<typeof handleLearningCsvImport>[1];

const csvText = "最初の文,添削後の文,ピン音\n我好,我很好,wo hen hao";

function csvForm(user?: string) {
  const formData = new FormData();
  formData.set(
    "csvFile",
    new File([csvText], "notes.csv", { type: "text/csv" }),
  );
  // A crafted request may carry `user`; the import must ignore it.
  if (user) formData.set("user", user);
  return formData;
}

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    getMember: async () => ({ githubId: "219588180" }),
    importCsv: async () => ({ ok: true, count: 1 }),
    ...overrides,
  };
}

// Silences console.error and returns what was logged.
async function captureErrors<T>(run: () => Promise<T>) {
  const logged: unknown[][] = [];
  const errors = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    return { result: await run(), logged };
  } finally {
    console.error = errors;
  }
}

test("CSV import passes only the file and reports the count", async () => {
  const received: unknown[][] = [];
  const state = await handleLearningCsvImport(
    csvForm("password:ckabc123"),
    dependencies({
      importCsv: async (...args) => {
        received.push(args);
        return { ok: true, count: 2 };
      },
    }),
  );
  assert.deepEqual(state, {
    status: "success",
    message: "2件の学習文を登録しました。",
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].length, 1);
  assert.ok(received[0][0] instanceof File);
  assert.equal((received[0][0] as File).name, "notes.csv");
});

test("CSV import shows the CSV's problem", async () => {
  const state = await handleLearningCsvImport(
    csvForm(),
    dependencies({
      importCsv: async () => ({ ok: false, message: "1行目は3列未満です。" }),
    }),
  );
  assert.deepEqual(state, { status: "error", message: "1行目は3列未満です。" });
});

test("CSV import checks the session and the file before importing", async () => {
  const fileless = new FormData();
  const textInstead = new FormData();
  textInstead.set("csvFile", csvText);
  for (const [form, getMember, message] of [
    [
      csvForm(),
      async () => null,
      "この操作を行う権限がありません。再度ログインしてください。",
    ],
    [
      csvForm(),
      async () => ({}),
      "一度ログアウトしてログインし直してください。",
    ],
    [fileless, undefined, "CSVファイルを選択してください。"],
    [textInstead, undefined, "CSVファイルを選択してください。"],
  ] as const) {
    let imported = false;
    const state = await handleLearningCsvImport(
      form,
      dependencies({
        ...(getMember ? { getMember } : {}),
        importCsv: async () => {
          imported = true;
          return { ok: true, count: 1 };
        },
      }),
    );
    assert.deepEqual(state, { status: "error", message });
    assert.equal(imported, false, message);
  }
});

test("CSV import asks to sign in again when the import is not allowed", async () => {
  const state = await handleLearningCsvImport(
    csvForm(),
    dependencies({
      importCsv: async () => {
        throw new LearningForbiddenError();
      },
    }),
  );
  assert.deepEqual(state, {
    status: "error",
    message: "ログインし直してください。",
  });
});

test("CSV import hides a failed write and logs only its code and name", async () => {
  const { result, logged } = await captureErrors(() =>
    handleLearningCsvImport(
      csvForm(),
      dependencies({
        importCsv: async () => {
          throw new Error(`insert failed: ${csvText}`);
        },
      }),
    ),
  );
  assert.deepEqual(result, {
    status: "error",
    message: "処理できませんでした。時間をおいてもう一度お試しください。",
  });
  assert.deepEqual(logged, [["CSV_IMPORT_FAILED", "Error"]]);
  assert.ok(!JSON.stringify(logged).includes("我好"));
});

test("CSV import lets Next's /signin redirect through", async () => {
  let thrown: unknown;
  try {
    redirect("/signin");
  } catch (error) {
    thrown = error;
  }
  await assert.rejects(
    handleLearningCsvImport(
      csvForm(),
      dependencies({
        importCsv: async () => {
          throw thrown;
        },
      }),
    ),
    (error) => error === thrown,
  );
});
