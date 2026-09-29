import assert from "node:assert/strict";
import { test } from "node:test";

import { loadIntegrationPreview } from "../src/presentation/presenters/integration-preview-presenter";
import { sampleIntegration } from "./fixtures/sample-integration";

test("preview loader returns the use case result without an error", async () => {
  const loaded = {
    sourceCount: 2,
    total: 9,
    preview: {
      stats: [{ label: "notes", value: "2" }],
      items: [{ title: "道", description: "量詞", lang: "zh-Hans" }],
    },
  };
  assert.deepEqual(
    await loadIntegrationPreview(sampleIntegration, {
      execute: async () => loaded,
    }),
    { ...loaded, error: null },
  );
});

test("preview loader hides database failures and logs only the code and id", async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logged.push(args);
  });
  const result = await loadIntegrationPreview(sampleIntegration, {
    execute: async () => {
      throw new Error("password=secret 我很好");
    },
  });
  assert.deepEqual(result, {
    sourceCount: 0,
    total: 0,
    preview: { stats: [], items: [] },
    error:
      "学習ノートを読み込めませんでした。データベースの状態を確認してください。",
  });
  assert.deepEqual(logged, [["INTEGRATION_PREVIEW_UNAVAILABLE", "sample"]]);
});
