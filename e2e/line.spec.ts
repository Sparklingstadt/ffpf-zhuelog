import { createHmac } from "node:crypto";
import { test, expect } from "./fixtures";
import { lineTestConfig } from "./environment";

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

test("LINE signed webhook is deduplicated and queued without creating a note", async ({
  request,
  db,
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
  expect((await send()).status()).toBe(200);
  expect((await send()).status()).toBe(200);
  const rows = (
    await db.query(
      'SELECT kind, status, "originalText", csv, "entryId" FROM "LineLearningJob"',
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe("correction");
  expect(rows[0].status).toBe("PENDING");
  expect(rows[0].originalText).toBe("今天我busy。");
  expect(rows[0].csv).toBeNull();
  expect(rows[0].entryId).toBeNull();
  expect(
    (await db.query('SELECT count(*)::int AS count FROM "LearningEntry"'))
      .rows[0].count,
  ).toBe(0);
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
});

test("oversized message is answered with the limit notice, never generated or stored", async ({
  request,
  db,
}) => {
  const body = payload("too-long", "字".repeat(501));
  expect(
    (
      await request.post("/api/line/webhook", {
        data: body,
        headers: { "x-line-signature": signature(body) },
      })
    ).status(),
  ).toBe(200);
  const stored = (
    await db.query(
      'SELECT kind, status, "originalText", "replyText", csv FROM "LineLearningJob"',
    )
  ).rows[0];
  expect(stored.kind).toBe("text-too-long");
  expect(stored.status).toBe("READY");
  expect(stored.originalText).toBe("");
  expect(stored.replyText).toContain("500文字");
  expect(stored.csv).toBeNull();
  expect(
    (await db.query('SELECT count(*)::int AS count FROM "LearningEntry"'))
      .rows[0].count,
  ).toBe(0);
});
