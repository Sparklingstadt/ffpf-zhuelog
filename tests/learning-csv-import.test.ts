import assert from "node:assert/strict";
import { test } from "node:test";

import { GoApiError } from "../src/infrastructure/go-api/client";
import { handleLearningCsvImport } from "../src/presentation/controllers/learning-csv-import-controller";

type Dependencies = Parameters<typeof handleLearningCsvImport>[1];

function csvForm(user?: string) {
  const formData = new FormData();
  formData.set(
    "csvFile",
    new File(
      ["最初の文,添削後の文,ピン音\n我好,我很好,wo hen hao"],
      "notes.csv",
      { type: "text/csv" },
    ),
  );
  // A crafted request may carry `user`; the import must ignore it.
  if (user) formData.set("user", user);
  return formData;
}

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    getMember: async () => ({ githubId: "219588180" }),
    importCsv: async () => 1,
    ...overrides,
  };
}

test("CSV import sends only the file and reports Go's count", async () => {
  const files: File[] = [];
  const state = await handleLearningCsvImport(
    csvForm("password:ckabc123"),
    dependencies({
      importCsv: async (file) => {
        files.push(file);
        return 2;
      },
    }),
  );
  assert.deepEqual(state, {
    status: "success",
    message: "2件の学習文を登録しました。",
  });
  assert.deepEqual(
    files.map((file) => file.name),
    ["notes.csv"],
  );
});

test("CSV import asks a session without an owner ID to sign in again", async () => {
  let imported = false;
  const state = await handleLearningCsvImport(
    csvForm(),
    dependencies({
      getMember: async () => ({}),
      importCsv: async () => {
        imported = true;
        return 1;
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

test("CSV import without a file does not call Go", async () => {
  let imported = false;
  const state = await handleLearningCsvImport(
    new FormData(),
    dependencies({
      importCsv: async () => {
        imported = true;
        return 1;
      },
    }),
  );
  assert.deepEqual(state, {
    status: "error",
    message: "CSVファイルを選択してください。",
  });
  assert.equal(imported, false);
});

// Go owns the size, extension and row checks; the web does not repeat them.
test("CSV import leaves size and extension checks to Go", async () => {
  const formData = new FormData();
  formData.set(
    "csvFile",
    new File([new Uint8Array(4 * 1024 * 1024 + 1)], "notes.txt"),
  );
  const files: string[] = [];
  const state = await handleLearningCsvImport(
    formData,
    dependencies({
      importCsv: async (file) => {
        files.push(file.name);
        return 1;
      },
    }),
  );
  assert.equal(state.status, "success");
  assert.deepEqual(files, ["notes.txt"]);
});

test("CSV import shows Go's message for invalid_csv and too_large", async () => {
  for (const error of [
    new GoApiError(400, "invalid_csv", "3行目: 列が足りません。"),
    new GoApiError(413, "too_large", "ファイルは4MB以下にしてください。"),
    new GoApiError(
      400,
      "invalid_request",
      "拡張子が.csvのファイルを選択してください。",
    ),
  ]) {
    const state = await handleLearningCsvImport(
      csvForm(),
      dependencies({
        importCsv: async () => {
          throw error;
        },
      }),
    );
    assert.deepEqual(state, { status: "error", message: error.userMessage });
  }
});

test("CSV import hides other Go failures behind the generic message", async () => {
  const errors = console.error;
  console.error = () => {};
  try {
    const state = await handleLearningCsvImport(
      csvForm(),
      dependencies({
        importCsv: async () => {
          throw new GoApiError(503, "unavailable", "停止中です");
        },
      }),
    );
    assert.equal(state.status, "error");
    assert.notEqual(state.message, "停止中です");
  } finally {
    console.error = errors;
  }
});

test("CSV import lets non-Go errors (such as the /signin redirect) through", async () => {
  const redirect = new Error("NEXT_REDIRECT");
  await assert.rejects(
    handleLearningCsvImport(
      csvForm(),
      dependencies({
        importCsv: async () => {
          throw redirect;
        },
      }),
    ),
    redirect,
  );
});
