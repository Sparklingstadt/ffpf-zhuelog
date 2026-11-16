import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import type { LineEvent } from "../src/domain/line/line-message";
import {
  handleLineWebhook,
  LINE_WEBHOOK_MAX_BODY_BYTES,
} from "../src/presentation/controllers/line-webhook-controller";

const SECRET = "channel-secret";
const START = new Date("2026-11-17T00:00:00.000Z");

const sign = (body: string | Uint8Array) =>
  createHmac("sha256", SECRET).update(body).digest("base64");

// Go's line_handlers_test twoEventBody: two text messages from users.
const twoEventBody = JSON.stringify({
  destination: "x",
  events: ["E1", "E2"].map((id) => ({
    type: "message",
    webhookEventId: id,
    replyToken: `reply-${id}`,
    source: { type: "user", userId: "U1" },
    message: { type: "text", text: "你好" },
  })),
});

function webhook(
  body: string | Uint8Array,
  signature: string | null = sign(body),
): { request: Request; read: () => boolean } {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== null) headers.set("x-line-signature", signature);
  const request = new Request("https://zhuelog.test/api/line/webhook", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : new Blob([body as BlobPart]),
  });
  return { request, read: () => request.bodyUsed };
}

function harness(
  handle: (event: LineEvent, deadline: Date) => Promise<void> = async () => {},
) {
  let now = START.getTime();
  const calls: { event: LineEvent; deadline: Date }[] = [];
  const logs: { code: string; fields?: Record<string, string | number> }[] = [];
  return {
    calls,
    logs,
    advance: (ms: number) => (now += ms),
    deps: {
      channelSecret: SECRET,
      bot: {
        async handleEvent(event: LineEvent, deadline: Date) {
          calls.push({ event, deadline });
          await handle(event, deadline);
        },
      },
      now: () => new Date(now),
      log: (code: string, fields?: Record<string, string | number>) =>
        logs.push({ code, fields }),
    },
  };
}

async function assertGoError(
  response: Response,
  status: number,
  code: string,
  message: string,
) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: { code, message } });
}

test("without LINE the webhook does not exist", async () => {
  for (const missing of [{ bot: undefined }, { channelSecret: undefined }]) {
    const h = harness();
    const { request, read } = webhook(twoEventBody);
    const response = await handleLineWebhook(request, {
      ...h.deps,
      ...missing,
    });
    await assertGoError(response, 404, "not_found", "見つかりません。");
    assert.equal(read(), false);
    assert.equal(h.calls.length, 0);
  }
});

test("an unsigned or wrongly signed webhook is refused before anything is read", async () => {
  for (const signature of [null, "", sign("other body")]) {
    const h = harness();
    const { request } = webhook(twoEventBody, signature);
    const response = await handleLineWebhook(request, h.deps);
    await assertGoError(response, 401, "unauthorized", "認証が必要です。");
    assert.equal(h.calls.length, 0);
  }
});

test("an oversized body is 413 and a malformed one 400", async () => {
  const big = new Uint8Array(LINE_WEBHOOK_MAX_BODY_BYTES + 1).fill(0x20);
  assert.equal(big.byteLength, 1_048_577);
  const h = harness();
  await assertGoError(
    await handleLineWebhook(webhook(big).request, h.deps),
    413,
    "too_large",
    "リクエストが大きすぎます。",
  );
  await assertGoError(
    await handleLineWebhook(webhook("not json").request, h.deps),
    400,
    "invalid_request",
    "リクエストが不正です。",
  );
  assert.equal(h.calls.length, 0);

  // Exactly the limit is read.
  const atLimit = new Uint8Array(LINE_WEBHOOK_MAX_BODY_BYTES).fill(0x20);
  atLimit.set(new TextEncoder().encode('{"events":[]}'));
  const response = await handleLineWebhook(webhook(atLimit).request, h.deps);
  assert.equal(response.status, 200);
});

test("every event shares one deadline and the answer is 200 whatever happens", async () => {
  const h = harness(async (event) => {
    h.advance(1000);
    if (event.webhookEventId === "E1") throw new Error("secret text 你好");
  });
  const response = await handleLineWebhook(
    webhook(twoEventBody).request,
    h.deps,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {});
  assert.deepEqual(
    h.calls.map((call) => call.event.webhookEventId),
    ["E1", "E2"],
  );
  for (const call of h.calls)
    assert.equal(call.deadline.getTime(), START.getTime() + 45_000);
  assert.deepEqual(h.logs, [
    { code: "LINE_EVENT_FAILED", fields: { eventId: "E1" } },
  ]);

  const empty = harness();
  const verify = await handleLineWebhook(
    webhook('{"events":[]}').request,
    empty.deps,
  );
  assert.equal(verify.status, 200);
  assert.deepEqual(await verify.json(), {});
  assert.equal(empty.calls.length, 0);
  assert.deepEqual(empty.logs, []);
});

test("the webhook stops starting events after 55 seconds", async () => {
  const h = harness(async () => {
    h.advance(55_000);
  });
  const response = await handleLineWebhook(
    webhook(twoEventBody).request,
    h.deps,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {});
  assert.deepEqual(
    h.calls.map((call) => call.event.webhookEventId),
    ["E1"],
  );
  assert.deepEqual(h.logs, [
    { code: "LINE_EVENTS_TIMED_OUT", fields: { count: 1 } },
  ]);

  // Just under the limit, the next event still starts.
  const before = harness(async () => {
    before.advance(54_999);
  });
  await handleLineWebhook(webhook(twoEventBody).request, before.deps);
  assert.equal(before.calls.length, 2);
});
