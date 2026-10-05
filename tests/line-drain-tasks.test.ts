import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CloudTasksDrainTrigger,
  getDrainTasksConfig,
} from "../src/infrastructure/line/cloud-tasks-drain-trigger";

const QUEUE = "projects/demo-project/locations/asia-northeast1/queues/line";
const SECRET = "s".repeat(32);
const ENV = {
  LINE_DRAIN_TASKS_QUEUE: QUEUE,
  CRON_SECRET: SECRET,
  AUTH_URL: "https://zhuelog.example.run.app",
};

test("Cloud Tasks is used only when the queue is configured", () => {
  assert.equal(getDrainTasksConfig({}), null);
  assert.deepEqual(getDrainTasksConfig(ENV), {
    queue: QUEUE,
    drainUrl: "https://zhuelog.example.run.app/api/line/drain",
    secret: SECRET,
  });
});

test("a broken Cloud Tasks setting falls back instead of enqueueing", () => {
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args[0]);
  try {
    for (const env of [
      { ...ENV, LINE_DRAIN_TASKS_QUEUE: "line" },
      { ...ENV, CRON_SECRET: "short" },
      { ...ENV, AUTH_URL: undefined },
      { ...ENV, AUTH_URL: "http://zhuelog.example.run.app" },
    ])
      assert.equal(getDrainTasksConfig(env), null);
  } finally {
    console.error = original;
  }
  assert.deepEqual(errors, Array(4).fill("LINE_DRAIN_TASKS_MISCONFIGURED"));
});

test("enqueue asks Cloud Tasks to call the drain with the cron secret", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return calls.length === 1
      ? Response.json({ access_token: "metadata-token", expires_in: 3599 })
      : Response.json({ name: `${QUEUE}/tasks/1` });
  }) as typeof fetch;
  const trigger = new CloudTasksDrainTrigger(
    getDrainTasksConfig(ENV)!,
    fetcher,
  );
  assert.equal(await trigger.enqueue(), true);

  assert.match(calls[0].url, /^http:\/\/metadata\.google\.internal\//);
  assert.deepEqual(calls[0].init.headers, { "Metadata-Flavor": "Google" });
  assert.equal(
    calls[1].url,
    `https://cloudtasks.googleapis.com/v2/${QUEUE}/tasks`,
  );
  assert.equal(calls[1].init.method, "POST");
  assert.equal(
    (calls[1].init.headers as Record<string, string>).Authorization,
    "Bearer metadata-token",
  );
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), {
    task: {
      dispatchDeadline: "120s",
      httpRequest: {
        httpMethod: "GET",
        url: "https://zhuelog.example.run.app/api/line/drain",
        headers: { Authorization: `Bearer ${SECRET}` },
      },
    },
  });
});

test("enqueue reports failure instead of throwing", async () => {
  const config = getDrainTasksConfig(ENV)!;
  const cases: (typeof fetch)[] = [
    (async () => new Response("", { status: 404 })) as typeof fetch,
    (async () => Response.json({})) as typeof fetch,
    (async (url: string) =>
      url.startsWith("http://metadata")
        ? Response.json({ access_token: "t" })
        : new Response("", { status: 403 })) as typeof fetch,
    (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch,
  ];
  for (const fetcher of cases)
    assert.equal(
      await new CloudTasksDrainTrigger(config, fetcher).enqueue(),
      false,
    );
});

test("enqueue gives up quickly so the webhook answers LINE in time", async () => {
  const hanging = ((_url: string, init: RequestInit) =>
    new Promise((_, reject) =>
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
    )) as typeof fetch;
  const started = Date.now();
  assert.equal(
    await new CloudTasksDrainTrigger(
      getDrainTasksConfig(ENV)!,
      hanging,
      50,
    ).enqueue(),
    false,
  );
  assert.ok(Date.now() - started < 1_000);
});
