import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import {
  batteryReportSchema,
  formatBatteryReply,
} from "../src/domain/line/battery-report";
import {
  parseMacBattery,
  readMacBattery,
} from "../src/infrastructure/macos/mac-battery-reader";
import { handleLineWebhook } from "../src/presentation/controllers/line-webhook-controller";
import { handleLineWorker } from "../src/presentation/controllers/line-worker-controller";
import { ProcessLineLearning } from "../src/application/line/use-cases/process-line-learning";
import type {
  LineJobRepository,
  LineMessenger,
} from "../src/application/line/ports/line-job-repository";
import type { LineJob, LineInput } from "../src/domain/line/line-learning";
import { LinePushMessenger } from "../src/infrastructure/line/line-messenger";

const checkedAt = "2026-09-24T15:00:00.000Z";
const report = {
  available: true as const,
  percent: 76,
  state: "discharging" as const,
  powerSource: "battery" as const,
  remainingMinutes: 163,
  checkedAt,
};
const config = {
  secret: "battery-test",
  accessToken: "unused",
  userId: `U${"1".repeat(32)}`,
  botId: `U${"2".repeat(32)}`,
  workerToken: "a".repeat(64),
};
const repo = (): LineJobRepository => ({
  enqueue: async () => {},
  claim: async () => null,
  leased: async () => null,
  saveResult: async () => {
    assert.fail("must never create a learning note");
  },
  saveReply: async () => true,
  finishDelivery: async () => {},
  fail: async () => {},
});
const messenger = (): LineMessenger => ({
  push: async () => {
    assert.fail("must not use CSV for battery");
  },
  pushText: async () => "accepted",
});
const job = (): LineJob => ({
  kind: "battery",
  id: "battery-job",
  eventId: "battery-event",
  userId: config.userId,
  originalText: "/battery",
  receivedAt: new Date(),
  status: "GENERATING",
  leaseToken: randomUUID(),
  csv: null,
  replyText: null,
  retryKey: randomUUID(),
  firstDeliveryAt: null,
  generationTries: 1,
  deliveryTries: 0,
});

test("pmset parser handles battery, charging, full, paused, estimates and no battery", () => {
  const parse = (
    state: string,
    time: string,
    source = "Battery Power",
    percent = 76,
  ) =>
    parseMacBattery(
      `Now drawing from '${source}'\n -InternalBattery-0 (id=123)\t${percent}%; ${state}; ${time} present: true\n`,
      checkedAt,
    );
  assert.deepEqual(parse("discharging", "2:43 remaining"), report);
  assert.deepEqual(parse("charging", "1:05 remaining", "AC Power"), {
    ...report,
    state: "charging",
    powerSource: "ac",
    remainingMinutes: 65,
  });
  assert.deepEqual(parse("charged", "0:00 remaining", "AC Power", 100), {
    ...report,
    percent: 100,
    state: "charged",
    powerSource: "ac",
    remainingMinutes: 0,
  });
  assert.deepEqual(parse("not charging", "(no estimate)", "AC Power"), {
    ...report,
    state: "not-charging",
    powerSource: "ac",
    remainingMinutes: null,
  });
  assert.equal(parse("discharging", "(no estimate)").available, true);
  assert.equal(
    parse("discharging", "0:00 remaining", "Battery Power", 0).available,
    true,
  );
  assert.deepEqual(
    parseMacBattery("Now drawing from 'AC Power'\n", checkedAt),
    { available: false, reason: "no-battery", checkedAt },
  );
  assert.deepEqual(parseMacBattery("invalid", checkedAt), {
    available: false,
    reason: "read-failed",
    checkedAt,
  });
  assert.equal(
    parse("charging", "1:00 remaining", "AC Power", 101).available,
    false,
  );
  assert.equal(
    parseMacBattery(
      "Now drawing from 'AC Power'\n -InternalBattery-0 unknown",
      checkedAt,
    ).available,
    false,
  );
});

test("battery replies are structured, bounded, timestamped and reject arbitrary payloads", () => {
  const text = formatBatteryReply(report);
  assert.match(text, /残量：76%/);
  assert.match(text, /バッテリー使用中/);
  assert.match(text, /2時間43分/);
  assert.match(text, /2026\/0?9\/25/);
  assert.match(text, /日本時間/);
  assert.doesNotMatch(text, /学習ノート/);
  assert.match(
    formatBatteryReply({ available: false, reason: "read-failed", checkedAt }),
    /取得できません/,
  );
  assert.match(
    formatBatteryReply({ ...report, state: "charging", powerSource: "ac" }),
    /満充電まで/,
  );
  assert.doesNotMatch(
    formatBatteryReply({ ...report, state: "charged" }),
    /時間の目安|満充電まで/,
  );
  for (const value of [
    { ...report, percent: 101 },
    { ...report, command: "rm" },
    { ...report, checkedAt: "not-a-date" },
    { ...report, remainingMinutes: -1 },
  ])
    assert.equal(batteryReportSchema.safeParse(value).success, false);
});

test("battery reader respects cancellation without running a command", async () => {
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(readMacBattery(abort.signal));
});

test("only exact owner battery commands pass the signed webhook", async () => {
  const jobs = repo();
  let queued: LineInput[] = [];
  jobs.enqueue = async (inputs) => {
    queued = inputs;
  };
  const event = {
    type: "message",
    mode: "active",
    webhookEventId: "battery-owner",
    timestamp: Date.now(),
    source: { type: "user", userId: config.userId },
    message: { type: "text", text: " /battery \n" },
  };
  const body = JSON.stringify({
    destination: config.botId,
    events: [
      event,
      { ...event, source: { type: "user", userId: "stranger" } },
      { ...event, source: { type: "group", userId: config.userId } },
      { ...event, message: { type: "text", text: "/battery 中文" } },
      { ...event, message: { type: "text", text: "/battery; uname -a" } },
      { ...event, timestamp: 0 },
      { ...event, mode: "standby" },
    ],
  });
  const request = (signed: boolean) =>
    new Request("https://example.test", {
      method: "POST",
      body,
      headers: signed
        ? {
            "x-line-signature": createHmac("sha256", config.secret)
              .update(body)
              .digest("base64"),
          }
        : {},
    });
  assert.equal(
    (await handleLineWebhook(request(false), config, jobs)).status,
    401,
  );
  assert.equal(queued.length, 0);
  assert.equal(
    (await handleLineWebhook(request(true), config, jobs)).status,
    200,
  );
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "battery");
  assert.equal(queued[0].originalText, "/battery");
});

test("worker capabilities, validation and cross-kind completion fail closed", async () => {
  const jobs = repo();
  const battery = job();
  const service = new ProcessLineLearning(jobs, messenger());
  let supportsBattery: boolean | undefined;
  let saved = 0;
  jobs.claim = async (_user, supported) => {
    supportsBattery = supported;
    return supported ? battery : null;
  };
  jobs.leased = async (_id, token, user) =>
    token === battery.leaseToken && user === battery.userId ? battery : null;
  jobs.saveReply = async (_job, text) => {
    saved++;
    assert.equal(text, formatBatteryReply(report));
    return true;
  };
  const send = (body: unknown, auth = true) =>
    handleLineWorker(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify(body),
        headers: auth ? { authorization: `Bearer ${config.workerToken}` } : {},
      }),
      config,
      jobs,
      service,
    );
  assert.equal(
    (await send({ action: "claim", capabilities: ["battery"] }, false)).status,
    401,
  );
  assert.equal((await send({ action: "claim" })).status, 200);
  assert.equal(supportsBattery, false);
  const claimed = await (
    await send({ action: "claim", capabilities: ["battery"] })
  ).json();
  assert.equal(claimed.job.phase, "battery");
  assert.equal(claimed.job.originalText, undefined);
  assert.equal(
    (await send({ action: "claim", capabilities: ["shell"] })).status,
    400,
  );
  const command = {
    action: "complete-battery",
    id: battery.id,
    leaseToken: battery.leaseToken,
    report,
  };
  assert.equal(
    (await send({ ...command, report: { ...report, text: "arbitrary" } }))
      .status,
    400,
  );
  assert.equal(
    (await send({ ...command, leaseToken: randomUUID() })).status,
    409,
  );
  assert.equal((await send(command)).status, 200);
  assert.equal(saved, 1);
  assert.equal(
    await service.complete(battery.id, battery.leaseToken!, battery.userId, {}),
    false,
  );
  battery.kind = "correction";
  assert.equal((await send(command)).status, 409);
});

test("battery delivery reuses persisted text and retry key without making a note", async () => {
  const jobs = repo();
  const battery = {
    ...job(),
    status: "SENDING",
    firstDeliveryAt: new Date(),
    replyText: formatBatteryReply(report),
  };
  jobs.leased = async () => battery;
  let sends = 0;
  let finished = false;
  const sender = messenger();
  sender.pushText = async (user, text, key) => {
    sends++;
    assert.equal(user, battery.userId);
    assert.equal(text, battery.replyText);
    assert.equal(key, battery.retryKey);
    return "accepted";
  };
  jobs.finishDelivery = async () => {
    finished = true;
  };
  const service = new ProcessLineLearning(jobs, sender);
  assert.equal(
    await service.deliver(battery.id, battery.leaseToken!, battery.userId),
    true,
  );
  assert.equal(sends, 1);
  assert.ok(finished);
  battery.firstDeliveryAt = new Date(0);
  assert.equal(
    await service.deliver(battery.id, battery.leaseToken!, battery.userId),
    true,
  );
  assert.equal(sends, 1);
});

test("plain text push preserves formatting and handles retries without leaking raw errors", async () => {
  const key = randomUUID();
  const text = formatBatteryReply(report);
  for (const status of [200, 409, 500]) {
    const sender = new LinePushMessenger("secret", async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        to: config.userId,
        messages: [{ type: "text", text }],
      });
      assert.equal(new Headers(init?.headers).get("X-Line-Retry-Key"), key);
      return new Response(null, {
        status,
        headers:
          status === 409 ? { "x-line-accepted-request-id": "accepted" } : {},
      });
    });
    assert.equal(
      await sender.pushText(config.userId, text, key),
      status === 500 ? "retry" : "accepted",
    );
  }
  const sender = new LinePushMessenger("secret", async () => {
    assert.fail("must not call LINE");
  });
  assert.equal(await sender.pushText(config.userId, " ", key), "rejected");
  assert.equal(
    await sender.pushText(config.userId, "a".repeat(5001), key),
    "rejected",
  );
});
