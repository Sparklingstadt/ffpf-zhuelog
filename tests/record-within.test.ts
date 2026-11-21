import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { recordWithin } from "../src/application/ai-usage/record-within";

test("a write that finishes in time is not logged and clears its timer", async () => {
  const setTimer = mock.method(globalThis, "setTimeout");
  const clearTimer = mock.method(globalThis, "clearTimeout");
  try {
    const logged: string[][] = [];
    let wrote = false;
    await recordWithin(
      async () => {
        wrote = true;
      },
      60_000,
      (code, name) => logged.push([code, name]),
    );
    assert.equal(wrote, true);
    assert.deepEqual(logged, []);
    assert.equal(setTimer.mock.callCount(), 1);
    const handle = setTimer.mock.calls[0].result;
    assert.ok(
      clearTimer.mock.calls.some((call) => call.arguments[0] === handle),
    );
  } finally {
    setTimer.mock.restore();
    clearTimer.mock.restore();
  }
});

test("a write that never finishes is given up as a TimeoutError", async () => {
  const logged: string[][] = [];
  await recordWithin(
    () => new Promise<void>(() => {}),
    5,
    (code, name) => logged.push([code, name]),
  );
  assert.deepEqual(logged, [["AI_USAGE_NOT_RECORDED", "TimeoutError"]]);
});

test("a failed write is logged by the error's name and never throws", async () => {
  class DbDown extends Error {
    override name = "DbDown";
  }
  const logged: string[][] = [];
  await recordWithin(
    async () => {
      throw new DbDown("connection string");
    },
    60_000,
    (code, name) => logged.push([code, name]),
  );
  assert.deepEqual(logged, [["AI_USAGE_NOT_RECORDED", "DbDown"]]);
});
