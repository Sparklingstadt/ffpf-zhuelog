import assert from "node:assert/strict";
import { test } from "node:test";
import { handleLineDrain } from "../src/presentation/controllers/line-drain-controller";

function request(authorization?: string) {
  return new Request("https://example.test/api/line/drain", {
    headers: authorization ? { authorization } : {},
  });
}
function fakeDrain(processed = 3) {
  const deadlines: number[] = [];
  return {
    deadlines,
    execute: async (deadline: number) => {
      deadlines.push(deadline);
      return processed;
    },
  };
}

test("drain requires the cron secret", async () => {
  for (const [header, secret] of [
    [undefined, "s3cret"],
    ["Bearer wrong", "s3cret"],
    ["Bearer ", undefined],
  ] as const) {
    const drain = fakeDrain();
    const response = await handleLineDrain(request(header), secret, drain);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(drain.deadlines.length, 0);
  }

  const drain = fakeDrain(7);
  const before = Date.now();
  const response = await handleLineDrain(
    request("Bearer s3cret"),
    "s3cret",
    drain,
  );
  const after = Date.now();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { processed: 7 });
  assert.equal(drain.deadlines.length, 1);
  assert.ok(drain.deadlines[0] >= before + 50_000);
  assert.ok(drain.deadlines[0] <= after + 50_000);

  const disabled = await handleLineDrain(
    request("Bearer s3cret"),
    "s3cret",
    null,
  );
  assert.equal(disabled.status, 503);
  assert.equal(disabled.headers.get("cache-control"), "no-store");
});

test("a failing drain answers 503 without leaking the error", async () => {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    const response = await handleLineDrain(request("Bearer s3cret"), "s3cret", {
      execute: async () => {
        throw new Error("secret row data");
      },
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "LINE_DRAIN_FAILED" });
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, [["LINE_DRAIN_FAILED"]]);
});
