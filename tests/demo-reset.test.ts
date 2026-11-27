import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createDemoReset } from "../src/application/demo/demo-reset";
import { buildDemoSeed, type DemoSeed } from "../src/domain/demo/demo-seed";

const fixture: unknown = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      "..",
      "src",
      "domain",
      "demo",
      "demo-fixture.json",
    ),
    "utf8",
  ),
);

const counter = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};

type Call = unknown[];

function fakeStore(calls: Call[]) {
  return {
    reset: async (...args: [string, string, DemoSeed, Date]) => {
      calls.push(["reset", ...args]);
      return "c1";
    },
    deleteStaleGuests: async (at: Date) => {
      calls.push(["deleteStaleGuests", at]);
      return 0;
    },
  };
}

for (const [name, loginId, password] of [
  ["DEMO_LOGIN_ID", undefined, "pw"],
  ["DEMO_PASSWORD", "demo", undefined],
] as const)
  test(`without ${name} there is no reset`, async () => {
    const calls: Call[] = [];
    const reset = createDemoReset({
      loginId,
      password,
      fixture,
      store: fakeStore(calls),
      newUuid: counter(),
      now: () => new Date("2026-11-10T19:00:00.000Z"),
    });
    assert.equal(reset.available, false);
    await assert.rejects(reset.reset());
    assert.deepEqual(calls, []);
  });

test("the reset stores the seed for now with DEMO_PASSWORD, then deletes stale guests", async () => {
  const now = new Date("2026-11-10T19:00:00.000Z");
  const calls: Call[] = [];
  const reset = createDemoReset({
    loginId: "demo",
    password: "demo-pass",
    fixture,
    store: fakeStore(calls),
    newUuid: counter(),
    now: () => now,
  });
  assert.equal(reset.available, true);
  await reset.reset();
  assert.deepEqual(calls, [
    ["reset", "demo", "demo-pass", buildDemoSeed(fixture, now, counter()), now],
    ["deleteStaleGuests", now],
  ]);
});
