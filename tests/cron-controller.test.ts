import assert from "node:assert/strict";
import { test } from "node:test";

import { handleCronRequest } from "../src/presentation/controllers/cron-controller";

const request = (authorization?: string) =>
  new Request("https://zhuelog.test/api/cron/line-drain", {
    headers: authorization ? { authorization } : {},
  });

test("only the cron secret runs the job", async () => {
  let runs = 0;
  const run = async () => {
    runs++;
  };
  for (const [authorization, secret] of [
    [undefined, "cron-secret"],
    ["Bearer wrong", "cron-secret"],
    ["Basic cron-secret", "cron-secret"],
    ["Bearer cron-secret", undefined],
    ["Bearer ", ""],
  ] as const) {
    const response = await handleCronRequest(request(authorization), {
      secret,
      run,
      failureCode: "TEST_FAILED",
    });
    assert.equal(response.status, 401, String(authorization));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: { code: "unauthorized", message: "認証が必要です。" },
    });
  }
  assert.equal(runs, 0);

  const ok = await handleCronRequest(request("Bearer cron-secret"), {
    secret: "cron-secret",
    run,
    failureCode: "TEST_FAILED",
  });
  assert.equal(runs, 1);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.equal(await ok.text(), "");

  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  let failed: Response;
  try {
    failed = await handleCronRequest(request("bearer cron-secret"), {
      secret: "cron-secret",
      run: async () => {
        throw new TypeError("contains secret things");
      },
      failureCode: "TEST_FAILED",
    });
  } finally {
    console.error = original;
  }
  assert.equal(failed.status, 500);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await failed.json(), {
    error: { code: "internal", message: "サーバーでエラーが発生しました。" },
  });
  assert.deepEqual(logged, [["TEST_FAILED", "TypeError"]]);
});
