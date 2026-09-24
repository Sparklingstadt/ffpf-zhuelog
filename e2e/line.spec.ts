import { createHmac } from "node:crypto";
import { test, expect, asAdmin } from "./fixtures";
import { authSecret, lineTestConfig } from "./environment";

const correction = {
  correctedText: "今天我很忙。",
  pinyin: "Jīntiān wǒ hěn máng.",
  hints: ["忙=máng=忙しい", "今天=今日"],
};
function payload(id = "event1") {
  return JSON.stringify({
    destination: lineTestConfig.botId,
    events: [
      {
        type: "message",
        mode: "active",
        webhookEventId: id,
        timestamp: Date.now(),
        source: { type: "user", userId: lineTestConfig.userId },
        message: { type: "text", text: "今天我busy。" },
      },
    ],
  });
}
const signature = (body: string) =>
  createHmac("sha256", lineTestConfig.secret).update(body).digest("base64");

test("LINE signed webhook -> leased correction -> one note and durable CSV outbox", async ({
  request,
  page,
  db,
  context,
}) => {
  const body = payload();
  const send = () =>
    request.post("/api/line/webhook", {
      data: body,
      headers: {
        "x-line-signature": signature(body),
        "Content-Type": "application/json",
      },
    });
  expect(
    (await request.post("/api/line/webhook", { data: body })).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/line/worker", { data: { action: "claim" } })
    ).status(),
  ).toBe(401);
  expect((await send()).status()).toBe(200);
  expect((await send()).status()).toBe(200);
  expect(
    (await db.query('SELECT count(*)::int AS count FROM "LineLearningJob"'))
      .rows[0].count,
  ).toBe(1);
  const worker = (data: unknown) =>
    request.post("/api/line/worker", {
      data,
      headers: { Authorization: `Bearer ${authSecret()}` },
    });
  const claims = await Promise.all([
    worker({ action: "claim" }),
    worker({ action: "claim" }),
  ]);
  const jobs = (await Promise.all(claims.map((result) => result.json())))
    .map((result) => result.job)
    .filter(Boolean);
  expect(jobs).toHaveLength(1);
  const job = jobs[0];
  expect(job.phase).toBe("generate");
  const complete = {
    action: "complete",
    id: job.id,
    leaseToken: job.leaseToken,
    correction,
  };
  expect((await worker(complete)).status()).toBe(200);
  expect((await worker(complete)).status()).toBe(409);
  const stored = (
    await db.query('SELECT status, csv, "entryId" FROM "LineLearningJob"')
  ).rows[0];
  expect(stored.status).toBe("READY");
  expect(stored.csv).toContain('"今天我busy。","今天我很忙。"');
  expect(stored.entryId).toBeTruthy();
  expect(
    (await db.query('SELECT count(*)::int AS count FROM "LearningEntry"'))
      .rows[0].count,
  ).toBe(1);
  await asAdmin(context);
  await page.goto("/");
  await expect(
    page.getByText(correction.pinyin, { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "この日の一覧" }).click();
  await expect(
    page.getByText(correction.correctedText, { exact: true }),
  ).toBeVisible();
  const delivery = (await (await worker({ action: "claim" })).json()).job;
  expect(delivery.phase).toBe("deliver");
  expect(delivery.originalText).toBeUndefined();
  // Deliberately do NOT call deliver against LINE; unit tests mock its HTTP API.
});

test("expired leases are reclaimed and stale workers cannot import", async ({
  request,
  db,
}) => {
  const body = payload("reclaim");
  await request.post("/api/line/webhook", {
    data: body,
    headers: { "x-line-signature": signature(body) },
  });
  const worker = (data: unknown) =>
    request.post("/api/line/worker", {
      data,
      headers: { Authorization: `Bearer ${authSecret()}` },
    });
  const first = (await (await worker({ action: "claim" })).json()).job;
  await db.query(
    'UPDATE "LineLearningJob" SET "availableAt" = NOW() - INTERVAL \'1 second\'',
  );
  const second = (await (await worker({ action: "claim" })).json()).job;
  expect(second.leaseToken).not.toBe(first.leaseToken);
  expect(
    (
      await worker({
        action: "complete",
        id: first.id,
        leaseToken: first.leaseToken,
        correction,
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await worker({
        action: "complete",
        id: second.id,
        leaseToken: second.leaseToken,
        correction,
      })
    ).status(),
  ).toBe(200);
});

test("owner battery command is deduplicated, capability-gated and never creates a learning note", async ({
  request,
  db,
}) => {
  const envelope = JSON.parse(payload("battery-command"));
  envelope.events[0].message.text = "/battery";
  const body = JSON.stringify(envelope);
  const send = () =>
    request.post("/api/line/webhook", {
      data: body,
      headers: { "x-line-signature": signature(body) },
    });
  expect((await send()).status()).toBe(200);
  expect((await send()).status()).toBe(200);
  expect(
    (await db.query('SELECT count(*)::int AS count FROM "LineLearningJob"'))
      .rows[0].count,
  ).toBe(1);
  const worker = (data: unknown) =>
    request.post("/api/line/worker", {
      data,
      headers: { Authorization: `Bearer ${authSecret()}` },
    });
  expect((await (await worker({ action: "claim" })).json()).job).toBeNull();
  const claims = await Promise.all([
    worker({ action: "claim", capabilities: ["battery"] }),
    worker({ action: "claim", capabilities: ["battery"] }),
  ]);
  const jobs = (await Promise.all(claims.map((value) => value.json())))
    .map((value) => value.job)
    .filter(Boolean);
  expect(jobs).toHaveLength(1);
  const first = jobs[0];
  expect(first.phase).toBe("battery");
  expect(first.originalText).toBeUndefined();
  expect(
    (
      await worker({
        action: "complete",
        id: first.id,
        leaseToken: first.leaseToken,
        correction,
      })
    ).status(),
  ).toBe(409);
  const report = {
    available: true,
    percent: 76,
    state: "discharging",
    powerSource: "battery",
    remainingMinutes: 163,
    checkedAt: new Date().toISOString(),
  };
  const complete = {
    action: "complete-battery",
    id: first.id,
    leaseToken: first.leaseToken,
    report,
  };
  expect(
    (
      await worker({ ...complete, report: { ...report, percent: 101 } })
    ).status(),
  ).toBe(400);
  await db.query(
    'UPDATE "LineLearningJob" SET "availableAt" = NOW() - INTERVAL \'1 second\'',
  );
  const second = (
    await (await worker({ action: "claim", capabilities: ["battery"] })).json()
  ).job;
  expect(second.leaseToken).not.toBe(first.leaseToken);
  expect((await worker(complete)).status()).toBe(409);
  const fresh = { ...complete, leaseToken: second.leaseToken };
  expect((await worker(fresh)).status()).toBe(200);
  expect((await worker(fresh)).status()).toBe(409);
  const stored = (
    await db.query(
      'SELECT kind, status, csv, "replyText", "entryId" FROM "LineLearningJob"',
    )
  ).rows[0];
  expect(stored.kind).toBe("battery");
  expect(stored.status).toBe("READY");
  expect(stored.csv).toBeNull();
  expect(stored.entryId).toBeNull();
  expect(stored.replyText).toContain("残量：76%");
  expect(stored.replyText).toContain("取得時刻：");
  expect(
    (await db.query('SELECT count(*)::int AS count FROM "LearningEntry"'))
      .rows[0].count,
  ).toBe(0);
  expect(
    (await db.query('SELECT count(*)::int AS count FROM "ImportBatch"')).rows[0]
      .count,
  ).toBe(0);
  expect((await (await worker({ action: "claim" })).json()).job).toBeNull();
  const delivery = (
    await (await worker({ action: "claim", capabilities: ["battery"] })).json()
  ).job;
  expect(delivery.phase).toBe("deliver");
  // Actual LINE delivery is verified separately; unit tests mock the HTTP API.
});
