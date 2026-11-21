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

test("without DEMO_LOGIN_ID there is no reset", async () => {
  const calls: unknown[] = [];
  const reset = createDemoReset({
    loginId: undefined,
    fixture,
    store: {
      reset: async (...args) => {
        calls.push(args);
        return "c1";
      },
    },
    newUuid: counter(),
    now: () => new Date("2026-11-10T19:00:00.000Z"),
  });
  assert.equal(reset.available, false);
  await assert.rejects(reset.reset());
  assert.deepEqual(calls, []);
});

test("the reset builds the seed for now and stores it", async () => {
  const now = new Date("2026-11-10T19:00:00.000Z");
  const calls: [string, DemoSeed, Date][] = [];
  const reset = createDemoReset({
    loginId: "demo",
    fixture,
    store: {
      reset: async (loginId, seed, at) => {
        calls.push([loginId, seed, at]);
        return "c1";
      },
    },
    newUuid: counter(),
    now: () => now,
  });
  assert.equal(reset.available, true);
  await reset.reset();
  assert.equal(calls.length, 1);
  const [loginId, seed, at] = calls[0];
  assert.equal(loginId, "demo");
  assert.equal(at, now);
  assert.deepEqual(seed, buildDemoSeed(fixture, now, counter()));
});
