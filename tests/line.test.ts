import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import { makeLineLearningResult } from "../src/domain/line/line-learning";
import type { LineInput, LineJob } from "../src/domain/line/line-learning";
import { CsvParseLearningParser } from "../src/infrastructure/csv/csv-parse-learning-parser";
import {
  verifyLineSignature,
  readLimitedBody,
} from "../src/infrastructure/line/security";
import { handleLineWebhook } from "../src/presentation/controllers/line-webhook-controller";
import { handleLineWorker } from "../src/presentation/controllers/line-worker-controller";
import { ProcessLineLearning } from "../src/application/line/use-cases/process-line-learning";
import type { LineJobRepository } from "../src/application/line/ports/line-job-repository";
import { LinePushMessenger } from "../src/infrastructure/line/line-messenger";
import { formatLineLearningReply } from "../src/infrastructure/line/line-reply-formatter";

const config = {
  secret: "test-secret",
  accessToken: "test-token",
  userId: `U${"1".repeat(32)}`,
  botId: `U${"2".repeat(32)}`,
  workerToken: "a".repeat(64),
};
const correction = {
  correctedText: '我说："你好"。\n今天很好。',
  pinyin: "Nǐ hǎo, jīntiān hěn hǎo.",
  hints: ["说=話す", '引用符 " と改行\nのテスト'],
};
const event = {
  type: "message",
  mode: "active",
  webhookEventId: "01TEST",
  timestamp: Date.now(),
  source: { type: "user", userId: config.userId },
  message: { type: "text", text: "今天我很忙。" },
};
const repo = (): LineJobRepository => ({
  enqueue: async () => {},
  claim: async () => null,
  leased: async () => null,
  saveResult: async () => true,
  saveReply: async () => true,
  finishDelivery: async () => {},
  fail: async () => {},
});
function webhook(events: unknown[] = [event], signature = true) {
  const body = JSON.stringify({ destination: config.botId, events });
  return new Request("https://example.test/api/line/webhook", {
    method: "POST",
    body,
    headers: signature
      ? {
          "x-line-signature": createHmac("sha256", config.secret)
            .update(body)
            .digest("base64"),
        }
      : {},
  });
}

test("CSV round trips through existing importer, including quotes/newlines/variable hints", () => {
  const { csv, draft } = makeLineLearningResult(
    '你好，"朋友"\n再见',
    correction,
  );
  assert.deepEqual(new CsvParseLearningParser().parse(csv), [draft]);
  assert.throws(() =>
    makeLineLearningResult("原文", { ...correction, pinyin: "" }),
  );
  assert.throws(() =>
    makeLineLearningResult("原文", {
      ...correction,
      hints: Array(6).fill("多い"),
    }),
  );
  assert.throws(() =>
    makeLineLearningResult("原文", { ...correction, originalText: "置換禁止" }),
  );
});

test("HMAC checks exact bytes and rejects tampering/malformed signatures", () => {
  const raw = Buffer.from('{"text":"你好\\n世界"}');
  const signature = createHmac("sha256", config.secret)
    .update(raw)
    .digest("base64");
  assert.ok(verifyLineSignature(raw, signature, config.secret));
  assert.equal(
    verifyLineSignature(
      Buffer.concat([raw, Buffer.from(" ")]),
      signature,
      config.secret,
    ),
    false,
  );
  for (const invalid of [null, "", "!!!!", signature.slice(1)])
    assert.equal(verifyLineSignature(raw, invalid, config.secret), false);
});

test("body limit works without a Content-Length header", async () => {
  await assert.rejects(
    readLimitedBody(
      new Request("https://example.test", {
        method: "POST",
        body: "a".repeat(101),
      }),
      100,
    ),
  );
});

test("webhook verification empty events succeeds, valid messages are queued", async () => {
  const jobs = repo();
  let inputs: LineInput[] = [];
  jobs.enqueue = async (value) => {
    inputs = value;
  };
  assert.equal(
    (await handleLineWebhook(webhook([]), config, jobs)).status,
    200,
  );
  assert.equal(inputs.length, 0);
  assert.equal((await handleLineWebhook(webhook(), config, jobs)).status, 200);
  assert.equal(inputs[0].originalText, event.message.text);
  assert.equal(inputs[0].eventId, event.webhookEventId);
});

test("disabled/unsigned webhooks cannot reach the queue", async () => {
  const jobs = repo();
  jobs.enqueue = async () => {
    assert.fail("must not enqueue");
  };
  assert.equal((await handleLineWebhook(webhook(), null, jobs)).status, 503);
  assert.equal(
    (await handleLineWebhook(webhook([], false), config, jobs)).status,
    401,
  );
});

test("ignore strangers, groups, images, oversized text, stale events and standby", async () => {
  const jobs = repo();
  let count = -1;
  jobs.enqueue = async (value) => {
    count = value.length;
  };
  const events = [
    { ...event, source: { type: "user", userId: "stranger" } },
    { ...event, source: { type: "group", userId: config.userId } },
    { ...event, message: { type: "image" } },
    { ...event, message: { type: "text", text: "字".repeat(501) } },
    { ...event, timestamp: 0 },
    { ...event, mode: "standby" },
  ];
  assert.equal(
    (await handleLineWebhook(webhook(events), config, jobs)).status,
    200,
  );
  assert.equal(count, 0);
});

test("worker rejects missing credentials and arbitrary payload fields", async () => {
  const jobs = repo();
  const service = new ProcessLineLearning(jobs, {
    push: async () => "accepted",
    pushText: async () => "accepted",
  });
  const request = (body: unknown, auth = true) =>
    new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify(body),
      headers: auth ? { authorization: `Bearer ${config.workerToken}` } : {},
    });
  assert.equal(
    (
      await handleLineWorker(
        request({ action: "claim" }, false),
        config,
        jobs,
        service,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await handleLineWorker(
        request({ action: "claim", userId: "stranger" }),
        config,
        jobs,
        service,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handleLineWorker(
        request({ action: "claim" }),
        config,
        jobs,
        service,
      )
    ).status,
    200,
  );
});

test("push uses stable retry key, accepts documented 409, sanitizes failures", async () => {
  const { csv } = makeLineLearningResult("你好", correction);
  for (const [status, acceptedId, expected] of [
    [200, false, "accepted"],
    [409, true, "accepted"],
    [409, false, "rejected"],
    [401, false, "rejected"],
    [500, false, "retry"],
  ] as const) {
    const key = randomUUID();
    const sender = new LinePushMessenger("secret", async (url, init) => {
      assert.equal(url, "https://api.line.me/v2/bot/message/push");
      assert.equal(new Headers(init?.headers).get("X-Line-Retry-Key"), key);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        to: config.userId,
        messages: [{ type: "text", text: formatLineLearningReply(csv) }],
      });
      return new Response(null, {
        status,
        headers: acceptedId ? { "x-line-accepted-request-id": "request" } : {},
      });
    });
    assert.equal(await sender.push(config.userId, csv, key), expected);
  }
});

test("LINE reply uses readable sections and numbered hints without changing the stored CSV", () => {
  const { csv, draft } = makeLineLearningResult(
    '你好，"朋友"\n再见',
    correction,
  );
  assert.equal(
    formatLineLearningReply(csv),
    [
      "添削しました。",
      '【あなたの文】\n你好，"朋友"\n再见',
      '【添削後の文】\n我说："你好"。\n今天很好。',
      "【ピン音】\nNǐ hǎo, jīntiān hěn hǎo.",
      '【学習ヒント】\n1. 说=話す\n\n2. 引用符 " と改行\nのテスト',
      "学習ノートに保存しました。",
    ].join("\n\n"),
  );
  assert.equal(formatLineLearningReply(csv), formatLineLearningReply(csv));
  assert.deepEqual(new CsvParseLearningParser().parse(csv), [draft]);
  const largest = makeLineLearningResult("字".repeat(500), {
    correctedText: "字".repeat(1000),
    pinyin: "a".repeat(1600),
    hints: Array(5).fill("字".repeat(200)),
  });
  assert.ok(formatLineLearningReply(largest.csv).length <= 5000);
});

test("invalid or oversized LINE replies fail before contacting LINE", async () => {
  const sender = new LinePushMessenger("secret", async () => {
    assert.fail("must not contact LINE");
  });
  const { csv } = makeLineLearningResult("原文", correction);
  for (const invalid of [
    '"broken',
    `${csv}\n${csv}`,
    `"${"字".repeat(5000)}","添削","pinyin"`,
  ]) {
    assert.equal(
      await sender.push(config.userId, invalid, randomUUID()),
      "rejected",
    );
  }
});

test("expired outbox stops without sending; retry reuses persisted CSV", async () => {
  const jobs = repo();
  let sends = 0;
  let failure = "";
  let sent = false;
  const job: LineJob = {
    kind: "correction",
    replyText: null,
    id: "job",
    eventId: "event",
    userId: config.userId,
    originalText: "原文",
    receivedAt: new Date(),
    status: "SENDING",
    leaseToken: randomUUID(),
    csv: '"CSV"',
    retryKey: randomUUID(),
    firstDeliveryAt: new Date(0),
    generationTries: 1,
    deliveryTries: 1,
  };
  jobs.leased = async () => job;
  jobs.fail = async (_job, permanent, code) => {
    assert.ok(permanent);
    failure = code;
  };
  jobs.finishDelivery = async () => {
    sent = true;
  };
  const service = new ProcessLineLearning(jobs, {
    pushText: async () => {
      assert.fail("must not send plain text for corrections");
    },
    push: async (_user, csv, key) => {
      sends++;
      assert.equal(csv, job.csv);
      assert.equal(key, job.retryKey);
      return "accepted";
    },
  });
  await service.deliver(job.id, job.leaseToken!, config.userId);
  assert.equal(failure, "DELIVERY_WINDOW_EXPIRED");
  assert.equal(sends, 0);
  job.firstDeliveryAt = new Date();
  await service.deliver(job.id, job.leaseToken!, config.userId);
  assert.equal(sends, 1);
  assert.ok(sent);
});
