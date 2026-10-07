import assert from "node:assert/strict";
import { test } from "node:test";

import type { IntegrationFile } from "@ffpf-zhuelog/core/integration";
import { handleIntegrationExport } from "../src/presentation/controllers/integration-export-controller";
import { sampleIntegration } from "./fixtures/sample-integration";

type Dependencies = Parameters<typeof handleIntegrationExport>[1];

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    getMember: async () => ({ githubId: "o1" }),
    findIntegration: (id) => (id === "sample" ? sampleIntegration : undefined),
    exportIntegration: {
      execute: async (): Promise<IntegrationFile | null> => null,
    },
    ...overrides,
  };
}

test("export API rejects non-admins before looking up the integration", async () => {
  let lookedUp = false;
  const response = await handleIntegrationExport(
    "sample",
    dependencies({
      getMember: async () => null,
      findIntegration: () => {
        lookedUp = true;
        return sampleIntegration;
      },
    }),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "管理者またはメンバーとしてログインしてください。",
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(lookedUp, false);
});

test("export API returns 404 for unknown integrations", async () => {
  const response = await handleIntegrationExport("unknown", dependencies());
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "連携が見つかりません。" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("export API returns 422 when there is nothing to export", async () => {
  const response = await handleIntegrationExport("sample", dependencies());
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: "出力できる項目がありません。",
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("export API sends the file as a private download", async () => {
  const file = {
    fileName: "sample.json",
    contentType: "application/json; charset=utf-8",
    body: '{"ok":true}',
  };
  const response = await handleIntegrationExport(
    "sample",
    dependencies({ exportIntegration: { execute: async () => file } }),
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/json; charset=utf-8",
  );
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="sample.json"',
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(await response.text(), '{"ok":true}');
});

test("export API hides failures and logs only the code and integration id", async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logged.push(args);
  });
  for (const execute of [
    async (): Promise<IntegrationFile | null> => {
      throw new Error("password=secret 我很好");
    },
    async (): Promise<IntegrationFile | null> => ({
      fileName: "sample.json",
      contentType: "text/plain\r\nX-Injected: yes",
      body: "",
    }),
  ]) {
    const response = await handleIntegrationExport(
      "sample",
      dependencies({ exportIntegration: { execute } }),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "出力ファイルを作成できませんでした。",
    });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.deepEqual(logged, [
    ["INTEGRATION_EXPORT_UNAVAILABLE", "sample"],
    ["INTEGRATION_EXPORT_UNAVAILABLE", "sample"],
  ]);
});
