import { createHmac, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "./fixtures";
import { cronSecret, lineStubUrl, lineTestConfig } from "./environment";

function payload(id = "event1", text = "今天我busy。") {
  return JSON.stringify({
    destination: lineTestConfig.botId,
    events: [
      {
        type: "message",
        mode: "active",
        webhookEventId: id,
        timestamp: Date.now(),
        source: { type: "user", userId: lineTestConfig.userId },
        message: { type: "text", text },
      },
    ],
  });
}
const signature = (body: string) =>
  createHmac("sha256", lineTestConfig.secret).update(body).digest("base64");

const sendWebhook = (request: APIRequestContext, id: string, text: string) => {
  const body = payload(id, text);
  return request.post("/api/line/webhook", {
    data: body,
    headers: {
      "x-line-signature": signature(body),
      "Content-Type": "application/json",
    },
  });
};

type Push = { to: string; messages: { type: string; text: string }[] };
const pushedTexts = async (request: APIRequestContext) =>
  ((await (await request.get(`${lineStubUrl}/__pushes`)).json()) as Push[]).map(
    (push) => push.messages[0].text,
  );

// The stubs keep their state across tests: start each test with an empty log.
test.beforeEach(async ({ request }) => {
  expect((await request.delete(`${lineStubUrl}/__pushes`)).status()).toBe(204);
});

test("LINE webhook rejects unsigned requests and deduplicates a redelivery", async ({
  request,
  db,
}) => {
  const body = payload();
  expect(
    (await request.post("/api/line/webhook", { data: body })).status(),
  ).toBe(401);
  expect((await sendWebhook(request, "event1", "今天我busy。")).status()).toBe(
    200,
  );
  expect((await sendWebhook(request, "event1", "今天我busy。")).status()).toBe(
    200,
  );
  await expect
    .poll(async () => {
      const { rows } = await db.query(
        'SELECT status FROM "LineLearningJob" WHERE "eventId" = $1',
        ["event1"],
      );
      return rows.map((row) => row.status);
    })
    .toEqual(["SENT"]);
  expect(
    (await db.query('SELECT count(*)::int AS count FROM "LineLearningJob"'))
      .rows[0].count,
  ).toBe(1);
  expect(
    (await db.query('SELECT count(*)::int AS count FROM "LearningEntry"'))
      .rows[0].count,
  ).toBe(1);
  expect(await pushedTexts(request)).toHaveLength(1);
});

test("former commands and non-Chinese text are not queued", async ({
  request,
  db,
}) => {
  for (const [index, text] of [
    "/battery",
    "/dev",
    "/devend",
    "Hello",
  ].entries()) {
    const body = payload(`ignored-${index}`, text);
    expect(
      (
        await request.post("/api/line/webhook", {
          data: body,
          headers: { "x-line-signature": signature(body) },
        })
      ).status(),
    ).toBe(200);
  }
  expect(
    (await db.query('SELECT count(*)::int AS count FROM "LineLearningJob"'))
      .rows[0].count,
  ).toBe(0);
  expect(await pushedTexts(request)).toEqual([]);
});

test("oversized message is answered with the limit notice, never generated or stored", async ({
  request,
  db,
}) => {
  expect(
    (await sendWebhook(request, "too-long", "字".repeat(501))).status(),
  ).toBe(200);
  await expect.poll(async () => (await pushedTexts(request)).length).toBe(1);
  expect((await pushedTexts(request))[0]).toContain("500文字");
  const stored = (
    await db.query(
      'SELECT kind, status, "originalText", "replyText", csv FROM "LineLearningJob"',
    )
  ).rows[0];
  expect(stored.kind).toBe("text-too-long");
  expect(stored.status).toBe("SENT");
  expect(stored.originalText).toBe("");
  expect(stored.replyText).toContain("500文字");
  expect(stored.csv).toBeNull();
  expect(
    (await db.query('SELECT count(*)::int AS count FROM "LearningEntry"'))
      .rows[0].count,
  ).toBe(0);
});

const jobStatuses = (db: import("pg").Client) => async () =>
  (
    await db.query(
      'SELECT status FROM "LineLearningJob" ORDER BY "createdAt", "eventId"',
    )
  ).rows.map((row) => row.status);

test("Japanese text is translated, saved as a translation note and replied", async ({
  request,
  db,
}) => {
  expect(
    (await sendWebhook(request, "ja-1", "今日は忙しいです。")).status(),
  ).toBe(200);
  await expect.poll(jobStatuses(db)).toEqual(["SENT"]);
  const entries = (
    await db.query(
      'SELECT kind, "originalText", "correctedText" FROM "LearningEntry"',
    )
  ).rows;
  expect(entries).toEqual([
    {
      kind: "translation",
      originalText: "今日は忙しいです。",
      correctedText: "今天我很忙。",
    },
  ]);
  const texts = await pushedTexts(request);
  expect(texts).toHaveLength(1);
  expect(texts[0]).toContain("【中国語訳】");
  expect(texts[0]).toContain("今天我很忙。");
  expect(texts[0]).not.toContain("【添削後】");
});

test("Chinese text is corrected and replied", async ({ request, db }) => {
  expect((await sendWebhook(request, "zh-1", "今天我busy。")).status()).toBe(
    200,
  );
  await expect.poll(jobStatuses(db)).toEqual(["SENT"]);
  expect(
    (await db.query('SELECT kind, "originalText" FROM "LearningEntry"')).rows,
  ).toEqual([{ kind: "correction", originalText: "今天我busy。" }]);
  const texts = await pushedTexts(request);
  expect(texts).toHaveLength(1);
  expect(texts[0]).toContain("【添削後】");
  expect(texts[0]).not.toContain("【中国語訳】");
});

test("a failed generation replies without a note", async ({ request, db }) => {
  expect(
    (await sendWebhook(request, "fail-1", "これは失敗します。")).status(),
  ).toBe(200);
  await expect.poll(jobStatuses(db)).toEqual(["SENT"]);
  expect(
    (await db.query('SELECT count(*)::int AS count FROM "LearningEntry"'))
      .rows[0].count,
  ).toBe(0);
  const texts = await pushedTexts(request);
  expect(texts).toHaveLength(1);
  expect(texts[0]).toContain("できませんでした");
});

test("two webhooks at once produce one note and one reply each", async ({
  request,
  db,
}) => {
  const responses = await Promise.all([
    sendWebhook(request, "both-1", "今日は忙しいです。"),
    sendWebhook(request, "both-2", "今天我busy。"),
  ]);
  expect(responses.map((response) => response.status())).toEqual([200, 200]);
  await expect.poll(jobStatuses(db)).toEqual(["SENT", "SENT"]);
  expect(
    (await db.query('SELECT kind FROM "LearningEntry" ORDER BY kind')).rows.map(
      (row) => row.kind,
    ),
  ).toEqual(["correction", "translation"]);
  const texts = await pushedTexts(request);
  expect(texts).toHaveLength(2);
  expect(texts.filter((text) => text.includes("【中国語訳】"))).toHaveLength(1);
  expect(texts.filter((text) => text.includes("【添削後】"))).toHaveLength(1);
});

test("the drain route requires the cron secret and picks up leftovers", async ({
  request,
  db,
}) => {
  await db.query(
    `INSERT INTO "LineLearningJob"
       (id, kind, "eventId", "userId", "originalText", "receivedAt", status, "availableAt", "retryKey")
     VALUES ($1, 'correction', 'leftover-1', $2, '今天我busy。', NOW(), 'PENDING', NOW() - interval '1 minute', $3)`,
    [randomUUID(), lineTestConfig.userId, randomUUID()],
  );
  expect((await request.get("/api/line/drain")).status()).toBe(401);
  expect(
    (
      await request.get("/api/line/drain", {
        headers: { Authorization: "Bearer wrong-secret" },
      })
    ).status(),
  ).toBe(401);
  expect(await jobStatuses(db)()).toEqual(["PENDING"]);
  expect(await pushedTexts(request)).toEqual([]);

  const response = await request.get("/api/line/drain", {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).processed).toBeGreaterThan(0);
  await expect.poll(jobStatuses(db)).toEqual(["SENT"]);
  const texts = await pushedTexts(request);
  expect(texts).toHaveLength(1);
  expect(texts[0]).toContain("【添削後】");
});
