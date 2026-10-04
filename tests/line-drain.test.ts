import assert from "node:assert/strict";
import { test } from "node:test";
import { createLineContainer } from "../src/composition/line-container";
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
    let created = 0;
    const response = await handleLineDrain(request(header), secret, () => {
      created++;
      return drain;
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(created, 0);
    assert.equal(drain.deadlines.length, 0);
  }

  const drain = fakeDrain(7);
  const before = Date.now();
  const response = await handleLineDrain(
    request("Bearer s3cret"),
    "s3cret",
    () => drain,
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
    () => null,
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
    const response = await handleLineDrain(
      request("Bearer s3cret"),
      "s3cret",
      () => ({
        execute: async () => {
          throw new Error("secret row data");
        },
      }),
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "LINE_DRAIN_FAILED" });
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, [["LINE_DRAIN_FAILED"]]);
});

test("a drain that cannot be created answers 503 and logs only the code", async () => {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    const response = await handleLineDrain(
      request("Bearer s3cret"),
      "s3cret",
      () => {
        throw new Error("INVALID_TEST_ENDPOINT https://evil.test");
      },
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "LINE_DRAIN_FAILED" });
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, [["LINE_DRAIN_FAILED"]]);
});

test("a bad endpoint override breaks only createDrain, never the container", () => {
  const keys = [
    "LINE_INTEGRATION_ENABLED",
    "LINE_CHANNEL_SECRET",
    "LINE_CHANNEL_ACCESS_TOKEN",
    "LINE_BOT_USER_ID",
    "LINE_ALLOWED_USER_ID",
    "OPENAI_API_BASE_URL",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      LINE_INTEGRATION_ENABLED: "true",
      LINE_CHANNEL_SECRET: "secret",
      LINE_CHANNEL_ACCESS_TOKEN: "token",
      LINE_BOT_USER_ID: `U${"2".repeat(32)}`,
      LINE_ALLOWED_USER_ID: `U${"1".repeat(32)}`,
      OPENAI_API_BASE_URL: "https://evil.test",
    });
    const container = createLineContainer();
    assert.ok(container.config);
    assert.throws(() => container.createDrain());
    delete process.env.OPENAI_API_BASE_URL;
    assert.ok(container.createDrain());
    delete process.env.LINE_INTEGRATION_ENABLED;
    const disabled = createLineContainer();
    assert.equal(disabled.config, null);
    assert.equal(disabled.createDrain(), null);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
