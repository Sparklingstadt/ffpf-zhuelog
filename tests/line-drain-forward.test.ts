import assert from "node:assert/strict";
import { test } from "node:test";
import { createLineContainer } from "../src/composition/line-container";
import {
  DrainForwarder,
  getDrainForwardConfig,
} from "../src/infrastructure/line/drain-forwarder";
import { handleLineDrain } from "../src/presentation/controllers/line-drain-controller";

const SECRET = "s".repeat(32);
const ENV = {
  LINE_DRAIN_FORWARD_URL: "https://zhuelog.example.run.app",
  CRON_SECRET: SECRET,
};

function silenceErrors() {
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  return { errors, restore: () => (console.error = original) };
}

test("forwarding is used only when the URL is configured", () => {
  assert.equal(getDrainForwardConfig({}), null);
  assert.equal(getDrainForwardConfig({ CRON_SECRET: SECRET }), null);
  assert.deepEqual(getDrainForwardConfig(ENV), {
    drainUrl: "https://zhuelog.example.run.app/api/line/drain",
    secret: SECRET,
  });
  // A trailing path is ignored: the drain is always at the same place.
  assert.equal(
    getDrainForwardConfig({
      ...ENV,
      LINE_DRAIN_FORWARD_URL: `${ENV.LINE_DRAIN_FORWARD_URL}/x/`,
    })?.drainUrl,
    "https://zhuelog.example.run.app/api/line/drain",
  );
});

test("a broken forwarding setting is refused", () => {
  const log = silenceErrors();
  try {
    for (const env of [
      { ...ENV, LINE_DRAIN_FORWARD_URL: "http://zhuelog.example.run.app" },
      { ...ENV, LINE_DRAIN_FORWARD_URL: "zhuelog.example.run.app" },
      { ...ENV, CRON_SECRET: "short" },
      { ...ENV, CRON_SECRET: undefined },
    ])
      assert.equal(getDrainForwardConfig(env), null);
  } finally {
    log.restore();
  }
  assert.deepEqual(
    log.errors,
    Array(4).fill(["LINE_DRAIN_FORWARD_MISCONFIGURED"]),
  );
});

test("forward calls the remote drain with the cron secret", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ processed: 2, extra: "ignored" });
  }) as typeof fetch;
  const response = await new DrainForwarder(
    getDrainForwardConfig(ENV)!,
    fetcher,
  ).forward();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { processed: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://zhuelog.example.run.app/api/line/drain");
  assert.equal(calls[0].init.method, undefined);
  assert.equal(calls[0].init.redirect, "error");
  assert.deepEqual(calls[0].init.headers, {
    Authorization: `Bearer ${SECRET}`,
  });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("forward reports a failed remote drain as 503 without its body", async () => {
  const log = silenceErrors();
  try {
    for (const [fetcher, logged] of [
      [
        async () => Response.json({ error: "UNAUTHORIZED" }, { status: 401 }),
        401,
      ],
      [
        async () => Response.json({ error: "LINE_DISABLED" }, { status: 503 }),
        503,
      ],
      [async () => new Response("<html>secret row</html>"), 200],
      [
        async () => {
          throw new Error("network");
        },
        undefined,
      ],
    ] as const) {
      const response = await new DrainForwarder(
        getDrainForwardConfig(ENV)!,
        fetcher as unknown as typeof fetch,
      ).forward();
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        error: "LINE_DRAIN_FORWARD_FAILED",
      });
      const last = log.errors.at(-1)!;
      assert.deepEqual(
        last,
        logged === undefined
          ? ["LINE_DRAIN_FORWARD_FAILED"]
          : ["LINE_DRAIN_FORWARD_FAILED", logged],
      );
    }
  } finally {
    log.restore();
  }
});

test("forward gives up after its timeout", async () => {
  const log = silenceErrors();
  try {
    // A remote that never answers; the ref'd timer keeps the test alive while
    // the forwarder's own (unref'd) timeout fires.
    const fetcher = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        const alive = setTimeout(() => reject(new Error("not aborted")), 5_000);
        init.signal!.addEventListener("abort", () => {
          clearTimeout(alive);
          reject(init.signal!.reason);
        });
      })) as typeof fetch;
    const response = await new DrainForwarder(
      getDrainForwardConfig(ENV)!,
      fetcher,
      10,
    ).forward();
    assert.equal(response.status, 503);
    assert.deepEqual(log.errors, [["LINE_DRAIN_FORWARD_FAILED"]]);
  } finally {
    log.restore();
  }
});

test("the drain forwards only after authenticating and only when LINE is off", async () => {
  const request = (authorization?: string) =>
    new Request("https://example.test/api/line/drain", {
      headers: authorization ? { authorization } : {},
    });
  let forwarded = 0;
  const forwarder = {
    forward: async () => {
      forwarded++;
      return Response.json({ processed: 4 });
    },
  };

  const unauthorized = await handleLineDrain(
    request("Bearer wrong"),
    SECRET,
    () => null,
    () => forwarder,
  );
  assert.equal(unauthorized.status, 401);
  assert.equal(forwarded, 0);

  const remote = await handleLineDrain(
    request(`Bearer ${SECRET}`),
    SECRET,
    () => null,
    () => forwarder,
  );
  assert.equal(remote.status, 200);
  assert.deepEqual(await remote.json(), { processed: 4 });
  assert.equal(forwarded, 1);

  const local = await handleLineDrain(
    request(`Bearer ${SECRET}`),
    SECRET,
    () => ({ execute: async () => 1 }),
    () => forwarder,
  );
  assert.deepEqual(await local.json(), { processed: 1 });
  assert.equal(forwarded, 1);
});

test("a server that runs LINE itself never forwards", () => {
  const keys = [
    "LINE_INTEGRATION_ENABLED",
    "LINE_CHANNEL_SECRET",
    "LINE_CHANNEL_ACCESS_TOKEN",
    "LINE_ALLOWED_USER_ID",
    "LINE_BOT_USER_ID",
    "LINE_DRAIN_FORWARD_URL",
    "CRON_SECRET",
  ] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, ENV);
    process.env.LINE_INTEGRATION_ENABLED = "false";
    assert.ok(createLineContainer().createDrainForwarder());

    Object.assign(process.env, {
      LINE_INTEGRATION_ENABLED: "true",
      LINE_CHANNEL_SECRET: "channel-secret",
      LINE_CHANNEL_ACCESS_TOKEN: "access-token",
      LINE_ALLOWED_USER_ID: `U${"a".repeat(32)}`,
      LINE_BOT_USER_ID: `U${"b".repeat(32)}`,
    });
    assert.equal(createLineContainer().createDrainForwarder(), null);
  } finally {
    for (const key of keys)
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
  }
});
