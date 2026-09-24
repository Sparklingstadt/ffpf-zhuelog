import { createHmac, randomUUID } from "node:crypto";
import { test, expect } from "./fixtures";
import { authSecret, lineTestConfig } from "./environment";

test("dev mode persists, deduplicates commands, protects old workers and returns to corrections", async ({
  request,
  db,
}) => {
  const baseTime = Date.now();
  let tick = 0;
  const send = async (
    text: string,
    id: string = randomUUID(),
    timestamp = baseTime + tick++,
  ) => {
    const body = JSON.stringify({
      destination: lineTestConfig.botId,
      events: [
        {
          type: "message",
          mode: "active",
          webhookEventId: id,
          timestamp,
          source: { type: "user", userId: lineTestConfig.userId },
          message: { type: "text", text },
        },
      ],
    });
    const response = await request.post("/api/line/webhook", {
      data: body,
      headers: {
        "x-line-signature": createHmac("sha256", lineTestConfig.secret)
          .update(body)
          .digest("base64"),
      },
    });
    expect(response.status()).toBe(200);
  };
  const worker = (data: unknown) =>
    request.post("/api/line/worker", {
      data,
      headers: { Authorization: `Bearer ${authSecret()}` },
    });
  await send("/dev", "start");
  await send("Improve search", "proposal");
  await send("/devend", "end");
  await send("/dev", "start", baseTime); // replay must not re-enable the mode
  await send("今天很忙。", "normal");
  expect(
    (await db.query('SELECT "expiresAt" FROM "LineDevelopmentSession"')).rows[0]
      .expiresAt,
  ).toBeNull();
  const kinds = (
    await db.query('SELECT "eventId", kind FROM "LineLearningJob"')
  ).rows;
  expect(kinds).toEqual(
    expect.arrayContaining([
      { eventId: "start", kind: "dev-reply" },
      { eventId: "proposal", kind: "dev-issue" },
      { eventId: "end", kind: "dev-reply" },
      { eventId: "normal", kind: "correction" },
    ]),
  );
  expect(kinds).toHaveLength(4);
  const old = (
    await (await worker({ action: "claim", capabilities: ["battery"] })).json()
  ).job;
  expect(old.phase).toBe("generate");
  expect(old.originalText).toBe("今天很忙。");
  const start = (
    await (
      await worker({ action: "claim", capabilities: ["development"] })
    ).json()
  ).job;
  expect(start.phase).toBe("deliver");
  const issue = (
    await (
      await worker({ action: "claim", capabilities: ["development"] })
    ).json()
  ).job;
  expect(issue.phase).toBe("issue");
  expect(issue.originalText).toBe("Improve search");
  const identity = { id: issue.id, leaseToken: issue.leaseToken };
  const permits = await Promise.all([
    worker({ action: "begin-issue", ...identity }),
    worker({ action: "begin-issue", ...identity }),
  ]);
  expect(
    (await Promise.all(permits.map((value) => value.json()))).filter(
      (value) => value.allowed,
    ),
  ).toHaveLength(1);
  const result = {
    outcome: "created",
    url: "https://github.com/Sparklingstadt/ffpf-zhuelog/issues/123",
  };
  expect(
    (
      await worker({
        action: "complete-issue",
        ...identity,
        result: { ...result, url: "https://evil.test" },
      })
    ).status(),
  ).toBe(400);
  // Crash/reclaim does not grant a second publication permit.
  await db.query(
    'UPDATE "LineLearningJob" SET "availableAt"=NOW()-INTERVAL \'1 second\' WHERE id=$1',
    [issue.id],
  );
  const reclaimed = (
    await (
      await worker({ action: "claim", capabilities: ["development"] })
    ).json()
  ).job;
  expect(reclaimed.id).toBe(issue.id);
  expect(
    (await worker({ action: "complete-issue", ...identity, result })).status(),
  ).toBe(409);
  const fresh = { id: reclaimed.id, leaseToken: reclaimed.leaseToken };
  expect(
    (await (await worker({ action: "begin-issue", ...fresh })).json()).allowed,
  ).toBe(false);
  expect(
    (await worker({ action: "complete-issue", ...fresh, result })).status(),
  ).toBe(200);
  expect(
    (await worker({ action: "complete-issue", ...fresh, result })).status(),
  ).toBe(409);
  const stored = (
    await db.query(
      'SELECT "replyText",csv,"entryId","issueAttempted" FROM "LineLearningJob" WHERE id=$1',
      [issue.id],
    )
  ).rows[0];
  expect(stored.replyText).toContain(result.url);
  expect(stored.csv).toBeNull();
  expect(stored.entryId).toBeNull();
  expect(stored.issueAttempted).toBe(true);
  expect(
    (await db.query('SELECT count(*)::int AS count FROM "LearningEntry"'))
      .rows[0].count,
  ).toBe(0);
  // No real GitHub or LINE writes are made by this test.
});

test("delayed messages, concurrent redelivery and expiry do not publish private text", async ({
  request,
  db,
}) => {
  const time = Date.now();
  const send = (text: string, id: string, timestamp: number) => {
    const body = JSON.stringify({
      destination: lineTestConfig.botId,
      events: [
        {
          type: "message",
          mode: "active",
          webhookEventId: id,
          timestamp,
          source: { type: "user", userId: lineTestConfig.userId },
          message: { type: "text", text },
        },
      ],
    });
    return request.post("/api/line/webhook", {
      data: body,
      headers: {
        "x-line-signature": createHmac("sha256", lineTestConfig.secret)
          .update(body)
          .digest("base64"),
      },
    });
  };
  const starts = await Promise.all([
    send("/dev", "start", time),
    send("/dev", "start", time),
  ]);
  expect(starts.every((value) => value.status() === 200)).toBe(true);
  expect((await send("通常の中文", "late", time - 1000)).status()).toBe(200);
  expect(
    (
      await db.query('SELECT kind FROM "LineLearningJob" WHERE "eventId"=$1', [
        "late",
      ])
    ).rows[0].kind,
  ).toBe("dev-reply");
  await db.query(
    'UPDATE "LineDevelopmentSession" SET "expiresAt"=NOW()-INTERVAL \'1 second\'',
  );
  expect((await send("改善内容", "expired", time + 1)).status()).toBe(200);
  const expiry = (
    await db.query(
      'SELECT kind,"replyText" FROM "LineLearningJob" WHERE "eventId"=$1',
      ["expired"],
    )
  ).rows[0];
  expect(expiry.kind).toBe("dev-reply");
  expect(expiry.replyText).toContain("期限");
  expect(
    (
      await db.query(
        'SELECT count(*)::int AS count FROM "LineLearningJob" WHERE kind=$1',
        ["dev-issue"],
      )
    ).rows[0].count,
  ).toBe(0);
});
