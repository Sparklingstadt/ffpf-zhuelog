import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createLineMessaging,
  LineApiError,
} from "../src/infrastructure/line/line-messaging";

type Call = { url: string; init: RequestInit };

function fakeFetch(answer: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return answer(url);
  }) as typeof fetch;
  return { calls, impl };
}

const config = {
  accessToken: "secret-token",
  apiBaseUrl: "http://127.0.0.1:1/",
};

test("replies and pushes are Messaging API requests with the bearer token", async () => {
  const { calls, impl } = fakeFetch(() => new Response("{}"));
  const line = createLineMessaging(config, impl);

  await line.reply("tok", ["a", "b"]);
  await line.push("U1", ["c"]);

  assert.equal(calls.length, 2);
  const [reply, push] = calls;
  assert.equal(reply.url, "http://127.0.0.1:1/v2/bot/message/reply");
  assert.equal(reply.init.method, "POST");
  assert.deepEqual(reply.init.headers, {
    "Content-Type": "application/json",
    Authorization: "Bearer secret-token",
  });
  assert.deepEqual(JSON.parse(String(reply.init.body)), {
    replyToken: "tok",
    messages: [
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ],
  });
  assert.equal(reply.init.redirect, "manual");
  assert.ok(reply.init.signal instanceof AbortSignal);

  assert.equal(push.url, "http://127.0.0.1:1/v2/bot/message/push");
  assert.equal(push.init.method, "POST");
  assert.deepEqual(JSON.parse(String(push.init.body)), {
    to: "U1",
    messages: [{ type: "text", text: "c" }],
  });
  assert.equal(push.init.redirect, "manual");
  assert.ok(push.init.signal instanceof AbortSignal);
});

test("message counts outside 1 to 5 are refused before sending", async () => {
  const { calls, impl } = fakeFetch(() => new Response("{}"));
  const line = createLineMessaging(config, impl);
  const six = ["1", "2", "3", "4", "5", "6"];

  for (const send of [
    () => line.reply("tok", []),
    () => line.reply("tok", six),
    () => line.push("U1", []),
    () => line.push("U1", six),
  ])
    await assert.rejects(
      send,
      (error) => error instanceof LineApiError && error.status === null,
    );
  assert.equal(calls.length, 0);

  await line.push("U1", six.slice(0, 5));
  assert.equal(calls.length, 1);
});

function assertNoSecrets(error: unknown) {
  assert.ok(error instanceof LineApiError);
  assert.equal(error.name, "LineApiError");
  for (const shown of [String(error), error.message, error.stack ?? ""])
    for (const secret of [
      "secret-token",
      "reply-token-1",
      "U-recipient",
      "private text",
    ])
      assert.ok(!shown.includes(secret), `${secret} leaked`);
}

test("errors never carry secrets", async () => {
  const failing = createLineMessaging(
    config,
    fakeFetch(() => new Response("secret-token private text", { status: 500 }))
      .impl,
  );
  for (const send of [
    () => failing.reply("reply-token-1", ["private text"]),
    () => failing.push("U-recipient", ["private text"]),
  ])
    await assert.rejects(send, (error) => {
      assertNoSecrets(error);
      return (error as LineApiError).status === 500;
    });

  const throwing = createLineMessaging(
    config,
    fakeFetch(() => {
      throw new TypeError(
        "fetch failed: secret-token reply-token-1 U-recipient private text",
      );
    }).impl,
  );
  for (const send of [
    () => throwing.reply("reply-token-1", ["private text"]),
    () => throwing.push("U-recipient", ["private text"]),
  ])
    await assert.rejects(send, (error) => {
      assertNoSecrets(error);
      return (error as LineApiError).status === null;
    });

  const redirecting = createLineMessaging(
    config,
    fakeFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://example.com/" },
        }),
    ).impl,
  );
  await assert.rejects(
    () => redirecting.reply("reply-token-1", ["private text"]),
    (error) => error instanceof LineApiError && error.status === 302,
  );
});

function quotaFetch(quota: Response, consumption?: Response) {
  return fakeFetch((url) => {
    if (url.endsWith("/v2/bot/message/quota")) return quota;
    if (url.endsWith("/v2/bot/message/quota/consumption") && consumption)
      return consumption;
    throw new Error(`unexpected ${url}`);
  });
}

test("the push quota is the limit minus this month's usage", async () => {
  const none = quotaFetch(Response.json({ type: "none" }));
  assert.deepEqual(await createLineMessaging(config, none.impl).pushQuota(), {
    unlimited: true,
  });
  assert.equal(none.calls.length, 1);
  assert.equal(none.calls[0].url, "http://127.0.0.1:1/v2/bot/message/quota");
  assert.equal(none.calls[0].init.method ?? "GET", "GET");
  assert.deepEqual(none.calls[0].init.headers, {
    Authorization: "Bearer secret-token",
  });
  assert.equal(none.calls[0].init.redirect, "manual");
  assert.ok(none.calls[0].init.signal instanceof AbortSignal);

  const limited = quotaFetch(
    Response.json({ type: "limited", value: 200 }),
    Response.json({ totalUsage: 170 }),
  );
  assert.deepEqual(
    await createLineMessaging(config, limited.impl).pushQuota(),
    { unlimited: false, remaining: 30 },
  );
  assert.equal(
    limited.calls[1].url,
    "http://127.0.0.1:1/v2/bot/message/quota/consumption",
  );
  assert.deepEqual(limited.calls[1].init.headers, {
    Authorization: "Bearer secret-token",
  });

  const overused = quotaFetch(
    Response.json({ type: "limited", value: 200 }),
    Response.json({ totalUsage: 250 }),
  );
  assert.deepEqual(
    await createLineMessaging(config, overused.impl).pushQuota(),
    { unlimited: false, remaining: 0 },
  );
});

test("push quota answers of the wrong shape are errors", async () => {
  const limit = () => Response.json({ type: "limited", value: 200 });
  const cases: [string, ReturnType<typeof quotaFetch>, number | null][] = [
    ["other type", quotaFetch(Response.json({ type: "other" })), null],
    ["no type", quotaFetch(Response.json({})), null],
    ["null body", quotaFetch(new Response("null")), null],
    ["not json", quotaFetch(new Response("not json")), null],
    ["quota status", quotaFetch(new Response("{}", { status: 500 })), 500],
    ["no totalUsage", quotaFetch(limit(), Response.json({})), null],
    [
      "null totalUsage",
      quotaFetch(limit(), Response.json({ totalUsage: null })),
      null,
    ],
    [
      "string totalUsage",
      quotaFetch(limit(), Response.json({ totalUsage: "170" })),
      null,
    ],
    [
      "string value",
      quotaFetch(Response.json({ type: "limited", value: "200" })),
      null,
    ],
    [
      "consumption status",
      quotaFetch(limit(), new Response("{}", { status: 403 })),
      403,
    ],
    [
      "too large",
      quotaFetch(
        new Response(`{"type":"none","pad":"${"x".repeat(1 << 20)}"}`),
      ),
      null,
    ],
  ];
  for (const [name, fake, status] of cases)
    await assert.rejects(
      () => createLineMessaging(config, fake.impl).pushQuota(),
      (error) => error instanceof LineApiError && error.status === status,
      name,
    );
});
