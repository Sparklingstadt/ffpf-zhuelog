import assert from "node:assert/strict";
import { test } from "node:test";

import type { RecordOwner } from "@ffpf-zhuelog/core/application/identity/use-cases/resolve-record-owner";
import type { IntegrationFile } from "@ffpf-zhuelog/core/integration";
import { handleIntegrationExport } from "../src/presentation/controllers/integration-export-controller";
import { sampleIntegration } from "./fixtures/sample-integration";

type Dependencies = Parameters<typeof handleIntegrationExport>[2];

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    getRecordOwner: async () => ({ kind: "self", ownerId: "o1" }),
    findIntegration: (id) => (id === "sample" ? sampleIntegration : undefined),
    exportIntegration: {
      execute: async (): Promise<IntegrationFile | null> => null,
    },
    ...overrides,
  };
}

for (const [owner, status, message] of [
  [
    { kind: "denied", reason: "unauthenticated" },
    401,
    "管理者またはメンバーとしてログインしてください。",
  ],
  [
    { kind: "denied", reason: "guest" },
    403,
    "管理者またはメンバーとしてログインしてください。",
  ],
  [
    { kind: "denied", reason: "reauth" },
    401,
    "一度ログアウトしてログインし直してください。",
  ],
  [{ kind: "redirect-self" }, 403, "この記録を出力する権限がありません。"],
] as const satisfies readonly (readonly [RecordOwner, number, string])[]) {
  test(`export API rejects ${owner.kind}${"reason" in owner ? `/${owner.reason}` : ""} before looking up the integration`, async () => {
    let lookedUp = false;
    let exported = false;
    const response = await handleIntegrationExport(
      "sample",
      "someone",
      dependencies({
        getRecordOwner: async () => owner,
        findIntegration: () => {
          lookedUp = true;
          return sampleIntegration;
        },
        exportIntegration: {
          execute: async () => {
            exported = true;
            return null;
          },
        },
      }),
    );
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: message });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(lookedUp, false);
    assert.equal(exported, false);
  });
}

test("export API resolves the requested user and exports that owner's notes", async () => {
  const requested: (string | undefined)[] = [];
  const exportedFor: string[] = [];
  for (const [user, owner] of [
    [undefined, { kind: "self", ownerId: "219588180" }],
    ["password:ckabc123", { kind: "other", ownerId: "password:ckabc123" }],
  ] as const satisfies readonly (readonly [
    string | undefined,
    RecordOwner,
  ])[]) {
    await handleIntegrationExport(
      "sample",
      user,
      dependencies({
        getRecordOwner: async (value) => {
          requested.push(value);
          return owner;
        },
        exportIntegration: {
          execute: async (ownerId) => {
            exportedFor.push(ownerId);
            return null;
          },
        },
      }),
    );
  }
  assert.deepEqual(requested, [undefined, "password:ckabc123"]);
  assert.deepEqual(exportedFor, ["219588180", "password:ckabc123"]);
});

test("export API returns 404 for unknown integrations", async () => {
  const response = await handleIntegrationExport(
    "unknown",
    undefined,
    dependencies(),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "連携が見つかりません。" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("export API returns 422 when there is nothing to export", async () => {
  const response = await handleIntegrationExport(
    "sample",
    undefined,
    dependencies(),
  );
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
    undefined,
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
      undefined,
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
