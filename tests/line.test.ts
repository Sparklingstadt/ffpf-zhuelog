import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  lineTextTooLongReply,
  makeLineLearningResult,
} from "@ffpf-zhuelog/core/domain/line/line-learning";
import type {
  LineInput,
  LineJob,
} from "@ffpf-zhuelog/core/domain/line/line-learning";
import { CsvParseLearningParser } from "../src/infrastructure/csv/csv-parse-learning-parser";
import {
  verifyBearerToken,
  verifyLineSignature,
  readLimitedBody,
} from "../src/infrastructure/line/security";
import { handleLineWebhook } from "../src/presentation/controllers/line-webhook-controller";
import { ProcessLineLearning } from "@ffpf-zhuelog/core/application/line/use-cases/process-line-learning";
import type { LineJobRepository } from "@ffpf-zhuelog/core/domain/line/repositories/line-job-repository";
import { LinePushMessenger } from "../src/infrastructure/line/line-messenger";
import { formatLineLearningReply } from "../src/infrastructure/line/line-reply-formatter";

const config = {
  secret: "test-secret",
  accessToken: "test-token",
  userId: `U${"1".repeat(32)}`,
  botId: `U${"2".repeat(32)}`,
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
    "correction",
    '你好，"朋友"\n再见',
    correction,
  );
  // The CSV carries no kind; it is set from the job when the entry is saved.
  const { kind, ...stored } = draft;
  assert.equal(kind, "correction");
  assert.deepEqual(new CsvParseLearningParser().parse(csv), [stored]);
  assert.throws(() =>
    makeLineLearningResult("correction", "原文", { ...correction, pinyin: "" }),
  );
  assert.throws(() =>
    makeLineLearningResult("correction", "原文", {
      ...correction,
      hints: Array(6).fill("多い"),
    }),
  );
  assert.throws(() =>
    makeLineLearningResult("correction", "原文", {
      ...correction,
      originalText: "置換禁止",
    }),
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

test("ignore strangers, groups, images, oversized non-Chinese text, stale events and standby", async () => {
  const jobs = repo();
  let count = -1;
  jobs.enqueue = async (value) => {
    count = value.length;
  };
  const events = [
    { ...event, source: { type: "user", userId: "stranger" } },
    { ...event, source: { type: "group", userId: config.userId } },
    { ...event, message: { type: "image" } },
    { ...event, message: { type: "text", text: "a".repeat(501) } },
    { ...event, message: { type: "text", text: "字".repeat(5001) } },
    { ...event, timestamp: 0 },
    { ...event, mode: "standby" },
  ];
  assert.equal(
    (await handleLineWebhook(webhook(events), config, jobs)).status,
    200,
  );
  assert.equal(count, 0);
});

test("webhook ignores former commands and non-Chinese text", async () => {
  for (const legacy of [config, { ...config, developmentEnabled: true }]) {
    const jobs = repo();
    let count = -1;
    jobs.enqueue = async (value) => {
      count = value.length;
    };
    const events = ["/battery", "/dev", "/devend", "Hello"].map((text, i) => ({
      ...event,
      webhookEventId: `legacy-${i}`,
      message: { type: "text", text },
    }));
    assert.equal(
      (await handleLineWebhook(webhook(events), legacy, jobs)).status,
      200,
    );
    assert.equal(count, 0);
  }
});

test("bearer tokens never match an empty secret", () => {
  assert.equal(verifyBearerToken("Bearer ", ""), false);
  assert.equal(verifyBearerToken("Bearer undefined", undefined), false);
  assert.equal(verifyBearerToken(null, "s3cret"), false);
  assert.equal(verifyBearerToken("Bearer s3cret", "s3cret"), true);
  assert.equal(verifyBearerToken("Bearer other!", "s3cret"), false);
});

test("oversized text that would be processed is queued as a reply without its content", async () => {
  const jobs = repo();
  let inputs: LineInput[] = [];
  jobs.enqueue = async (value) => {
    inputs = value;
  };
  const events = [
    { ...event, message: { type: "text", text: "字".repeat(501) } },
  ];
  assert.equal(
    (await handleLineWebhook(webhook(events), config, jobs)).status,
    200,
  );
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].kind, "text-too-long");
  assert.equal(inputs[0].originalText, "");
  assert.equal(inputs[0].eventId, event.webhookEventId);
});

test("text-too-long jobs are delivered as the limit notice", async () => {
  const jobs = repo();
  let finished = false;
  const job: LineJob = {
    kind: "text-too-long",
    id: "too-long-job",
    eventId: "too-long-event",
    userId: config.userId,
    originalText: "",
    receivedAt: new Date(),
    status: "SENDING",
    leaseToken: randomUUID(),
    csv: null,
    replyText: lineTextTooLongReply,
    retryKey: randomUUID(),
    firstDeliveryAt: new Date(),
    generationTries: 0,
    deliveryTries: 1,
  };
  jobs.leased = async () => job;
  jobs.fail = async (_job, _permanent, code) => assert.fail(code);
  jobs.finishDelivery = async () => {
    finished = true;
  };
  const sent: string[] = [];
  const service = new ProcessLineLearning(jobs, {
    push: async () => assert.fail("must not send CSV"),
    pushText: async (_user, text) => {
      sent.push(text);
      return "accepted";
    },
  });
  assert.equal(
    await service.deliver(job.id, job.leaseToken!, config.userId),
    true,
  );
  assert.deepEqual(sent, [lineTextTooLongReply]);
  assert.match(lineTextTooLongReply, /500文字/);
  assert.ok(finished);
});

test("a correction too long for LINE is replied to as a failure, never retried silently", async () => {
  const jobs = repo();
  const job: LineJob = {
    kind: "correction",
    id: "long-result",
    eventId: "long-result-event",
    userId: config.userId,
    // Quotes double in CSV, so a valid 500-character message can overflow.
    originalText: `${'"'.repeat(499)}字`,
    receivedAt: new Date(),
    status: "GENERATING",
    leaseToken: randomUUID(),
    csv: null,
    replyText: null,
    retryKey: randomUUID(),
    firstDeliveryAt: null,
    generationTries: 1,
    deliveryTries: 0,
  };
  let saved: { text: string; code?: string } | undefined;
  jobs.leased = async () => job;
  jobs.saveResult = async () => assert.fail("must not save a learning note");
  jobs.saveReply = async (_job, text, code) => {
    saved = { text, code };
    return true;
  };
  const service = new ProcessLineLearning(jobs, {
    push: async () => assert.fail("must not send"),
    pushText: async () => assert.fail("must not send"),
  });
  assert.equal(
    await service.complete(job.id, job.leaseToken!, config.userId, {
      correctedText: `${'"'.repeat(999)}字`,
      pinyin: "a".repeat(1600),
      hints: ['"'.repeat(200)],
    }),
    true,
  );
  assert.equal(saved?.code, "CORRECTION_TOO_LONG");
  assert.match(saved!.text, /短く/);
  assert.ok(!saved!.text.includes("復旧後"));
});

test("push uses stable retry key, accepts documented 409, sanitizes failures", async () => {
  const { csv } = makeLineLearningResult("correction", "你好", correction);
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
        messages: [
          { type: "text", text: formatLineLearningReply(csv, "correction") },
        ],
      });
      return new Response(null, {
        status,
        headers: acceptedId ? { "x-line-accepted-request-id": "request" } : {},
      });
    });
    assert.equal(
      await sender.push(config.userId, csv, "correction", key),
      expected,
    );
  }
});

test("LINE reply uses readable sections and numbered hints without changing the stored CSV", () => {
  const { csv, draft } = makeLineLearningResult(
    "correction",
    '你好，"朋友"\n再见',
    correction,
  );
  assert.equal(
    formatLineLearningReply(csv, "correction"),
    [
      '【元の文】\n你好，"朋友"\n再见',
      '【添削後】\n我说："你好"。\n今天很好。\nNǐ hǎo, jīntiān hěn hǎo.',
      '【ヒント】\n1. 说=話す\n2. 引用符 " と改行\nのテスト',
    ].join("\n\n"),
  );
  assert.equal(
    formatLineLearningReply(csv, "correction"),
    formatLineLearningReply(csv, "correction"),
  );
  // The CSV carries no kind; it is set from the job when the entry is saved.
  const { kind, ...stored } = draft;
  assert.equal(kind, "correction");
  assert.deepEqual(new CsvParseLearningParser().parse(csv), [stored]);
  const largest = makeLineLearningResult("correction", "字".repeat(500), {
    correctedText: "字".repeat(1000),
    pinyin: "a".repeat(1600),
    hints: Array(5).fill("字".repeat(200)),
  });
  assert.ok(formatLineLearningReply(largest.csv, "correction").length <= 5000);
});

test("invalid or oversized LINE replies fail before contacting LINE", async () => {
  const sender = new LinePushMessenger("secret", async () => {
    assert.fail("must not contact LINE");
  });
  const { csv } = makeLineLearningResult("correction", "原文", correction);
  for (const invalid of [
    '"broken',
    `${csv}\n${csv}`,
    `"${"字".repeat(5000)}","添削","pinyin"`,
  ]) {
    assert.equal(
      await sender.push(config.userId, invalid, "correction", randomUUID()),
      "rejected",
    );
  }
});

test("a delivery without content or a first attempt is not reported as expired", async () => {
  const base: LineJob = {
    kind: "correction",
    replyText: null,
    id: "broken-job",
    eventId: "broken-event",
    userId: config.userId,
    originalText: "原文",
    receivedAt: new Date(),
    status: "SENDING",
    leaseToken: randomUUID(),
    csv: '"CSV"',
    retryKey: randomUUID(),
    firstDeliveryAt: new Date(),
    generationTries: 1,
    deliveryTries: 1,
  };
  for (const job of [
    { ...base, csv: null },
    { ...base, kind: "battery" as const },
    { ...base, firstDeliveryAt: null },
  ]) {
    const jobs = repo();
    const failures: [boolean, string][] = [];
    jobs.leased = async () => job;
    jobs.fail = async (_job, permanent, code) => {
      failures.push([permanent, code]);
    };
    const service = new ProcessLineLearning(jobs, {
      push: async () => assert.fail("must not send"),
      pushText: async () => assert.fail("must not send"),
    });
    assert.equal(
      await service.deliver(job.id, job.leaseToken!, config.userId),
      true,
    );
    assert.deepEqual(failures, [[true, "DELIVERY_STATE_INVALID"]]);
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
    push: async (_user, csv, kind, key) => {
      sends++;
      assert.equal(csv, job.csv);
      assert.equal(kind, "correction");
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

test("correction failure is persisted before text delivery, with bounded retry and no note", async () => {
  const jobs = repo();
  const job: LineJob = {
    kind: "correction",
    id: "failed-job",
    eventId: "failed-event",
    userId: config.userId,
    originalText: "private text",
    receivedAt: new Date(),
    status: "GENERATING",
    leaseToken: randomUUID(),
    csv: null,
    replyText: null,
    retryKey: randomUUID(),
    firstDeliveryAt: null,
    generationTries: 1,
    deliveryTries: 0,
  };
  let savedCode: string | undefined;
  let deliveries = 0;
  let failures = 0;
  let finished = false;
  jobs.leased = async (_id, token, _user, status) =>
    token === job.leaseToken && status === job.status ? job : null;
  jobs.saveResult = async () => assert.fail("must not save a learning note");
  jobs.saveReply = async (_job, text, code) => {
    savedCode = code;
    job.replyText = text;
    job.status = "READY";
    return true;
  };
  jobs.fail = async (_job, permanent) => {
    assert.equal(permanent, false);
    failures++;
  };
  jobs.finishDelivery = async () => {
    finished = true;
  };
  const service = new ProcessLineLearning(jobs, {
    push: async () => assert.fail("must not send CSV"),
    pushText: async (user, text, key) => {
      assert.equal(user, config.userId);
      assert.equal(key, job.retryKey);
      assert.match(text, /OPENAI_TIMEOUT/);
      assert.ok(!text.includes(job.originalText));
      return ++deliveries === 1 ? "retry" : "accepted";
    },
  });
  assert.equal(
    await service.generationFailed(
      job.id,
      job.leaseToken!,
      config.userId,
      "OPENAI_TIMEOUT",
    ),
    true,
  );
  assert.equal(savedCode, "OPENAI_TIMEOUT");
  assert.equal(deliveries, 0);
  assert.equal(
    await service.generationFailed(
      job.id,
      job.leaseToken!,
      config.userId,
      "OPENAI_TIMEOUT",
    ),
    false,
  );
  job.status = "SENDING";
  job.firstDeliveryAt = new Date();
  await service.deliver(job.id, job.leaseToken!, config.userId);
  await service.deliver(job.id, job.leaseToken!, config.userId);
  assert.equal(failures, 1);
  assert.equal(deliveries, 2);
  assert.ok(finished);
});

const translation = {
  translatedText: "今天我很忙。",
  pinyin: "Jīntiān wǒ hěn máng.",
  hints: ["忙=忙しい"],
};
const translationJob = (over: Partial<LineJob> = {}): LineJob => ({
  kind: "translation",
  id: "translation-job",
  eventId: "translation-event",
  userId: config.userId,
  originalText: "今日は忙しいです。",
  receivedAt: new Date(),
  status: "GENERATING",
  leaseToken: randomUUID(),
  csv: null,
  replyText: null,
  retryKey: randomUUID(),
  firstDeliveryAt: null,
  generationTries: 1,
  deliveryTries: 0,
  ...over,
});

test("translation jobs are saved as translation notes", async () => {
  const jobs = repo();
  const job = translationJob();
  let draft: unknown;
  jobs.leased = async () => job;
  jobs.saveResult = async (_job, _ownerId, saved) => {
    draft = saved;
    return true;
  };
  jobs.saveReply = async () => assert.fail("must save a note, not a reply");
  const service = new ProcessLineLearning(jobs, {
    push: async () => assert.fail("must not send"),
    pushText: async () => assert.fail("must not send"),
  });
  assert.equal(
    await service.complete(job.id, job.leaseToken!, config.userId, translation),
    true,
  );
  assert.deepEqual(draft, {
    originalText: job.originalText,
    correctedText: translation.translatedText,
    pinyin: translation.pinyin,
    hints: translation.hints,
    kind: "translation",
  });
});

test("translation failures reply without a note", async () => {
  const jobs = repo();
  const job = translationJob();
  let reply: { text: string; code?: string } | undefined;
  jobs.leased = async () => job;
  jobs.saveResult = async () => assert.fail("must not save a learning note");
  jobs.fail = async () => assert.fail("must reply instead of failing");
  jobs.saveReply = async (_job, text, code) => {
    reply = { text, code };
    return true;
  };
  const service = new ProcessLineLearning(jobs, {
    push: async () => assert.fail("must not send"),
    pushText: async () => assert.fail("must not send"),
  });
  assert.equal(
    await service.generationFailed(
      job.id,
      job.leaseToken!,
      config.userId,
      "OPENAI_TIMEOUT",
    ),
    true,
  );
  assert.ok(reply!.text.startsWith("翻訳できませんでした。"));
  assert.equal(reply!.code, "OPENAI_TIMEOUT");
});

test("a translation too long for LINE is replied to as a failure", async () => {
  const jobs = repo();
  const job = translationJob({ originalText: `${'"'.repeat(499)}字` });
  let reply: { text: string; code?: string } | undefined;
  jobs.leased = async () => job;
  jobs.saveResult = async () => assert.fail("must not save a learning note");
  jobs.saveReply = async (_job, text, code) => {
    reply = { text, code };
    return true;
  };
  const service = new ProcessLineLearning(jobs, {
    push: async () => assert.fail("must not send"),
    pushText: async () => assert.fail("must not send"),
  });
  assert.equal(
    await service.complete(job.id, job.leaseToken!, config.userId, {
      translatedText: `${'"'.repeat(999)}字`,
      pinyin: "a".repeat(1600),
      hints: ['"'.repeat(200)],
    }),
    true,
  );
  assert.equal(reply?.code, "CORRECTION_TOO_LONG");
  assert.ok(reply!.text.startsWith("翻訳できませんでした。"));
});

test("translation jobs are delivered as CSV with their kind, or as their failure text", async () => {
  for (const [over, via] of [
    [{ csv: '"CSV"' }, "push"],
    [{ csv: null, replyText: "翻訳できませんでした。" }, "pushText"],
  ] as const) {
    const jobs = repo();
    const job = translationJob({
      ...over,
      status: "SENDING",
      firstDeliveryAt: new Date(),
    });
    const calls: unknown[][] = [];
    let finished = false;
    jobs.leased = async () => job;
    jobs.fail = async (_job, _permanent, code) => assert.fail(code);
    jobs.finishDelivery = async () => {
      finished = true;
    };
    const service = new ProcessLineLearning(jobs, {
      push: async (...args) => {
        calls.push(["push", ...args]);
        return "accepted";
      },
      pushText: async (...args) => {
        calls.push(["pushText", ...args]);
        return "accepted";
      },
    });
    assert.equal(
      await service.deliver(job.id, job.leaseToken!, config.userId),
      true,
    );
    assert.ok(finished);
    assert.deepEqual(
      calls,
      via === "push"
        ? [["push", config.userId, '"CSV"', "translation", job.retryKey]]
        : [["pushText", config.userId, job.replyText, job.retryKey]],
    );
  }
});

test("translation replies use the translation heading", () => {
  const { csv } = makeLineLearningResult(
    "translation",
    "今日は忙しいです。",
    translation,
  );
  const text = formatLineLearningReply(csv, "translation");
  assert.ok(text.includes("【中国語訳】\n今天我很忙。\nJīntiān wǒ hěn máng."));
  assert.ok(!text.includes("【添削後】"));
  assert.ok(text.includes("【元の文】\n今日は忙しいです。"));
  assert.ok(text.includes("【ヒント】\n1. 忙=忙しい"));
  const corrected = formatLineLearningReply(
    makeLineLearningResult("correction", "你好", correction).csv,
    "correction",
  );
  assert.ok(corrected.includes("【添削後】"));
  assert.ok(!corrected.includes("【中国語訳】"));
});

test("the LINE messenger formats translation pushes with the translation heading", async () => {
  const { csv } = makeLineLearningResult(
    "translation",
    "今日は忙しいです。",
    translation,
  );
  const sender = new LinePushMessenger("secret", async (_url, init) => {
    const { messages } = JSON.parse(String(init?.body));
    assert.ok(messages[0].text.includes("【中国語訳】"));
    return new Response(null, { status: 200 });
  });
  assert.equal(
    await sender.push(config.userId, csv, "translation", randomUUID()),
    "accepted",
  );
});

test("Japanese text is queued for translation", async () => {
  const jobs = repo();
  let inputs: LineInput[] = [];
  jobs.enqueue = async (value) => {
    inputs = value;
  };
  const texts = [
    "今日は忙しい。",
    "我喜欢アニメ",
    "今天很忙。",
    "あ".repeat(501),
    "/今日は",
  ];
  const events = texts.map((text, i) => ({
    ...event,
    webhookEventId: `jp-${i}`,
    message: { type: "text", text },
  }));
  assert.equal(
    (await handleLineWebhook(webhook(events), config, jobs)).status,
    200,
  );
  assert.deepEqual(
    inputs.map((input) => [input.eventId, input.kind, input.originalText]),
    [
      ["jp-0", "translation", "今日は忙しい。"],
      ["jp-1", "translation", "我喜欢アニメ"],
      ["jp-2", "correction", "今天很忙。"],
      ["jp-3", "text-too-long", ""],
    ],
  );
});
