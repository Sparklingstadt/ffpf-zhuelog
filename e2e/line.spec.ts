import { createHmac, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { Client } from "pg";
import {
  baseURL,
  cronSecret,
  lineChannelSecret,
  lineStubURL,
} from "./environment";
import {
  anyWidth,
  asGuest,
  asMember,
  createMember,
  expect,
  memberOwnerId,
  openSiteMenu,
  seedNotes,
  test,
} from "./fixtures";
import type { LineSent } from "./line-stub";

type LineEventBody = Record<string, unknown>;

// A LINE user id of this test, as LINE spells them.
const newLineUser = () => `U${randomUUID().replaceAll("-", "")}`;

// A text message event from a user; its reply token is unique to the run.
function textEvent(id: string, userId: string, text: string): LineEventBody {
  return messageEvent(id, userId, { type: "text", text });
}

function messageEvent(
  id: string,
  userId: string,
  message: Record<string, unknown>,
): LineEventBody {
  return {
    type: "message",
    webhookEventId: id,
    replyToken: `reply-${id}`,
    source: { type: "user", userId },
    message,
  };
}

const newEventId = () => randomUUID().replaceAll("-", "");

// Posts a delivery to the web's webhook, signed as LINE signs it.
async function sendLineEvents(events: LineEventBody[]) {
  const body = JSON.stringify({ destination: "x", events });
  const signature = createHmac("sha256", lineChannelSecret())
    .update(body)
    .digest("base64");
  const response = await fetch(`${baseURL}/api/line/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-line-signature": signature,
    },
    body,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({});
}

// What the stub received for a reply token or a LINE user.
async function sentTo(query: { replyToken: string } | { to: string }) {
  const response = await fetch(
    `${lineStubURL}/e2e/line/sent?${new URLSearchParams(query)}`,
  );
  return ((await response.json()) as { sent: LineSent[] }).sent;
}

const repliesTo = async (event: LineEventBody) =>
  (await sentTo({ replyToken: event.replyToken as string })).map(
    (item) => item.texts,
  );

function linkLine(
  db: Client,
  lineUser: string,
  owner: string,
  reviewNotify = false,
) {
  return db.query(
    'INSERT INTO "LineLink" ("lineUserId", "ownerId", "role", "createdAt", "reviewNotify") VALUES ($1, $2, $3, NOW(), $4)',
    [lineUser, owner, "member", reviewNotify],
  );
}

function runDrain(authorization?: string) {
  return fetch(`${baseURL}/api/cron/line-drain`, {
    headers: authorization ? { authorization } : {},
  });
}

test("linked members can unlink and see links completed in LINE without reloading", async ({
  page,
  db,
}) => {
  const id = await createMember(
    db,
    "line-member",
    "連携会員",
    "member-password-1",
  );
  const owner = memberOwnerId(id);
  const lineUser = `U${randomUUID().replaceAll("-", "")}`;
  const link = () =>
    db.query(
      'INSERT INTO "LineLink" ("lineUserId", "ownerId", "role", "createdAt") VALUES ($1, $2, $3, NOW())',
      [lineUser, owner, "member"],
    );
  await link();
  await asMember(page, "line-member", "member-password-1");
  await page.goto("/account/line");
  const unlink = page.getByRole("button", {
    name: "連携を解除",
    exact: true,
  });
  await expect(unlink).toBeVisible();
  await unlink.click();
  const issue = page.getByRole("button", { name: "連携コードを出す" });
  await expect(issue).toBeVisible();
  expect(
    (await db.query('SELECT 1 FROM "LineLink" WHERE "ownerId"=$1', [owner]))
      .rowCount,
  ).toBe(0);

  await issue.click();
  await expect(page.locator("output")).toBeVisible();
  // Simulate the link completed by LINE's webhook, outside the open page.
  await link();
  await expect(unlink).toBeVisible();
  await expect(page.locator("output")).toHaveCount(0);
  await unlink.click();
  await expect(issue).toBeVisible();
  await expect(page.locator("output")).toHaveCount(0);
});

test("member issues a LINE link code with a matching QR and mobile link", async ({
  page,
  db,
}, testInfo) => {
  await createMember(db, "taro", "太郎", "member-password-1");
  await asMember(page, "taro", "member-password-1");

  await (
    await openSiteMenu(page)
  )
    .getByRole("menuitem", { name: "LINE 連携" })
    .click();
  await expect(page).toHaveURL((url) => url.pathname === "/account/line");
  await expect(
    page.getByRole("heading", { name: "LINE 連携", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("OpenAI（ChatGPT）に送られます")).toBeVisible();

  await page.clock.install();
  await page.getByRole("button", { name: "連携コードを出す" }).click();
  const output = page.locator("output");
  await expect(output).toContainText("まで有効（10分）");
  await expect(output.locator("span").first()).toHaveText(/^[A-Z2-9]{8}$/);
  const firstCode = (await output.locator("span").first().innerText()).trim();
  const openLine = page.getByRole("link", { name: "LINEで開く", exact: true });
  await expect(openLine).toHaveAttribute(
    "href",
    `https://line.me/R/oaMessage/%40393bohaw/?${firstCode}`,
  );
  const qr = page.getByRole("img", { name: "LINE連携用QRコード", exact: true });
  await expect(qr).toBeVisible();

  await page.getByRole("button", { name: "連携コードを出す" }).click();
  await expect(output.locator("span").first()).not.toHaveText(firstCode);
  const code = (await output.locator("span").first().innerText()).trim();
  const expectedUrl = `https://line.me/R/oaMessage/%40393bohaw/?${code}`;
  await expect(openLine).toHaveAttribute("href", expectedUrl);
  await qr.evaluate((node) =>
    node.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await qr.screenshot({ path: testInfo.outputPath("line-link-qr.png") });
  await writeFile(testInfo.outputPath("line-message-url.txt"), expectedUrl);
  await page.screenshot({
    path: testInfo.outputPath("line-link-screen.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await page.clock.fastForward(10 * 60 * 1000 + 1000);
  await expect(qr).toHaveCount(0);
  await expect(openLine).toHaveCount(0);
  await expect(
    page.getByText(/連携コードの有効期限が切れました/),
  ).toBeVisible();
});

test("guest has no LINE link menu and is sent away from the page", async ({
  page,
}) => {
  await asGuest(page);
  await expect(
    (await openSiteMenu(page)).getByRole("menuitem", { name: "LINE 連携" }),
  ).toHaveCount(0);

  await page.goto("/account/line");
  await expect(page).toHaveURL((url) => url.pathname === "/");
});

test(
  "a LINE message becomes a learning note and a reply",
  anyWidth,
  async ({ page, db }) => {
    const owner = memberOwnerId(
      await createMember(db, "line-writer", "LINE会員", "member-password-1"),
    );
    const lineUser = newLineUser();
    await linkLine(db, lineUser, owner);

    const event = textEvent(newEventId(), lineUser, "我昨天去图书馆了。");
    await sendLineEvents([event]);
    expect(await repliesTo(event)).toEqual([
      [
        "【元の文】\n我昨天去图书馆了。\n\n【添削後】\n我昨天去图书馆了。（添削）\n\n【ピンイン】\ne2e pīnyīn\n\n【ヒント】\n・e2e のヒント 1\n・e2e のヒント 2\n\n学習ノートに保存しました",
      ],
    ]);

    const { rows: notes } = await db.query(
      `SELECT e."kind", e."correctedText", b."fileName",
            (SELECT count(*)::int FROM "Hint" h WHERE h."learningEntryId" = e."id") AS hints
       FROM "LearningEntry" e JOIN "ImportBatch" b ON b."id" = e."batchId"
      WHERE e."ownerId" = $1`,
      [owner],
    );
    expect(notes).toEqual([
      {
        kind: "correction",
        correctedText: "我昨天去图书馆了。（添削）",
        fileName: "LINE",
        hints: 2,
      },
    ]);
    const { rows: messages } = await db.query(
      `SELECT "status", "text", "attempts" FROM "LineMessage" WHERE "lineUserId" = $1`,
      [lineUser],
    );
    expect(messages).toEqual([{ status: "done", text: null, attempts: 1 }]);
    await expect
      .poll(async () => {
        const { rows } = await db.query(
          `SELECT "ownerId", "inputTokens", "outputTokens" FROM "AiUsage" WHERE "feature" = 'line'`,
        );
        return rows;
      })
      .toEqual([{ ownerId: owner, inputTokens: 15, outputTokens: 25 }]);

    await asMember(page, "line-writer", "member-password-1");
    await page.goto("/logs");
    await page.getByRole("link", { name: /^\d+月\d+日 1件$/ }).click();
    await expect(page.getByText("我昨天去图书馆了。").first()).toBeVisible();

    // LINE delivering the same event again changes nothing.
    await sendLineEvents([event]);
    expect(await repliesTo(event)).toHaveLength(1);
    const { rows: count } = await db.query(
      `SELECT count(*)::int AS n FROM "LearningEntry" WHERE "ownerId" = $1`,
      [owner],
    );
    expect(count[0].n).toBe(1);
  },
);

test("a Japanese message is translated", anyWidth, async ({ db }) => {
  const owner = memberOwnerId(
    await createMember(db, "line-ja", "翻訳会員", "member-password-1"),
  );
  const lineUser = newLineUser();
  await linkLine(db, lineUser, owner);

  const event = textEvent(newEventId(), lineUser, "週末は友達と映画を見ます。");
  await sendLineEvents([event]);
  const replies = await repliesTo(event);
  expect(replies).toHaveLength(1);
  expect(replies[0][0]).toContain("【中国語訳】\ne2e 的翻译");
  const { rows } = await db.query(
    `SELECT "kind" FROM "LearningEntry" WHERE "ownerId" = $1`,
    [owner],
  );
  expect(rows).toEqual([{ kind: "translation" }]);
});

test("a code issued on the web page links through the webhook", async ({
  page,
  db,
}) => {
  const owner = memberOwnerId(
    await createMember(db, "line-coder", "コード会員", "member-password-1"),
  );
  await asMember(page, "line-coder", "member-password-1");
  await page.goto("/account/line");
  await page.getByRole("button", { name: "連携コードを出す" }).click();
  const code = (
    await page.locator("output").locator("span").first().innerText()
  ).trim();
  expect(code).toMatch(/^[A-Z2-9]{8}$/);

  const lineUser = newLineUser();
  const event = textEvent(newEventId(), lineUser, code.toLowerCase());
  await sendLineEvents([event]);
  expect(await repliesTo(event)).toEqual([
    [
      "連携しました。これから、このトークに送った文を添削・翻訳して学習ノートに保存します。",
    ],
  ]);
  await expect(
    page.getByRole("button", { name: "連携を解除", exact: true }),
  ).toBeVisible();
  expect(
    (
      await db.query('SELECT 1 FROM "LineLinkCode" WHERE "ownerId" = $1', [
        owner,
      ])
    ).rowCount,
  ).toBe(0);
  const { rows } = await db.query(
    `SELECT "lineUserId", "role" FROM "LineLink" WHERE "ownerId" = $1`,
    [owner],
  );
  expect(rows).toEqual([{ lineUserId: lineUser, role: "member" }]);

  const again = textEvent(newEventId(), lineUser, code);
  await sendLineEvents([again]);
  expect(await repliesTo(again)).toEqual([
    [
      "コードが違うか期限が切れています。Web の連携画面で新しいコードを出して、もう一度送ってください。",
    ],
  ]);
});

test(
  "an unlinked sender, a sticker and a long text get their fixed replies",
  anyWidth,
  async ({ db }) => {
    const owner = memberOwnerId(
      await createMember(db, "line-other", "その他会員", "member-password-1"),
    );
    const lineUser = newLineUser();

    const hello = textEvent(newEventId(), lineUser, "你好");
    await sendLineEvents([hello]);
    expect(await repliesTo(hello)).toEqual([
      [
        "まだ連携していません。Web のアカウント画面（/account/line）で連携コードを出して、このトークに送ってください。",
      ],
    ]);

    await linkLine(db, lineUser, owner);
    const sticker = messageEvent(newEventId(), lineUser, { type: "sticker" });
    const long = textEvent(newEventId(), lineUser, "漢".repeat(501));
    await sendLineEvents([sticker, long]);
    expect(await repliesTo(sticker)).toEqual([
      [
        "中国語の文を送ると添削します。日本語の文を送ると中国語に翻訳します。結果は学習ノートに保存されます。",
      ],
    ]);
    expect(await repliesTo(long)).toEqual([
      ["文が長すぎます。500 文字までにして、もう一度送ってください。"],
    ]);
    expect((await db.query('SELECT 1 FROM "LineMessage"')).rowCount).toBe(0);
  },
);

test(
  "a failed generation stays pending and the drain finishes it",
  anyWidth,
  async ({ db }) => {
    const owner = memberOwnerId(
      await createMember(db, "line-fail", "失敗会員", "member-password-1"),
    );
    const lineUser = newLineUser();
    await linkLine(db, lineUser, owner);

    const event = textEvent(newEventId(), lineUser, "[fail]我想去北京。");
    await sendLineEvents([event]);
    expect(await repliesTo(event)).toEqual([
      ["時間がかかっています。結果は翌朝までにこのトークにお送りします。"],
    ]);
    const message = () =>
      db.query(
        `SELECT "status", "attempts", "text" IS NULL AS cleared FROM "LineMessage" WHERE "lineUserId" = $1`,
        [lineUser],
      );
    expect((await message()).rows).toEqual([
      { status: "pending", attempts: 1, cleared: false },
    ]);
    await db.query(
      `UPDATE "LineMessage" SET "createdAt" = NOW() - interval '10 minutes' WHERE "lineUserId" = $1`,
      [lineUser],
    );

    // The route's own refusal, not the proxy's {"error": "認証が必要です。"}.
    const refused = await runDrain();
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({
      error: { code: "unauthorized", message: "認証が必要です。" },
    });
    expect((await sentTo({ to: lineUser })).length).toBe(0);

    const drained = await runDrain(`Bearer ${cronSecret()}`);
    expect(drained.status).toBe(204);
    expect(
      (await sentTo({ to: lineUser })).map((item) => [item.kind, item.texts]),
    ).toEqual([
      [
        "push",
        [
          "添削できませんでした。うまく処理できませんでした。しばらくしてからもう一度送ってください。\n（コード: OPENAI_REQUEST_FAILED）",
        ],
      ],
    ]);
    expect((await message()).rows).toEqual([
      { status: "failed", attempts: 2, cleared: true },
    ]);
  },
);

test(
  "the drain pushes late results and the morning review message once",
  anyWidth,
  async ({ db }) => {
    const owner = memberOwnerId(
      await createMember(db, "line-morning", "朝会員", "member-password-1"),
    );
    const lineUser = newLineUser();
    await linkLine(db, lineUser, owner, true);
    await db.query(
      `INSERT INTO "LineMessage" ("id", "webhookEventId", "lineUserId", "ownerId", "kind", "text", "status", "attempts", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'correction', '我想去北京。', 'pending', 0, NOW() - interval '10 minutes', NOW() - interval '10 minutes')`,
      [`m${newEventId()}`, newEventId(), lineUser, owner],
    );
    await seedNotes(db, owner, [{ text: "我喜欢学习。" }]);
    await db.query(
      `INSERT INTO "ReviewItem" ("id", "ownerId", "language", "kind", "targetId", "due", "state", "createdAt", "updatedAt")
     SELECT 'c' || substr(md5(random()::text), 1, 24), $1, 'zh', 'entry', e."id",
            NOW() - interval '1 hour', 0, NOW(), NOW()
       FROM "LearningEntry" e WHERE e."ownerId" = $1`,
      [owner],
    );

    const pushes = async () =>
      (await sentTo({ to: lineUser })).map((item) => {
        expect(item.kind).toBe("push");
        return item.texts;
      });
    expect((await runDrain(`Bearer ${cronSecret()}`)).status).toBe(204);
    const sent = await pushes();
    expect(sent).toHaveLength(2);
    expect(sent[0]).toHaveLength(1);
    expect(sent[0][0]).toContain("【添削後】\n我想去北京。（添削）");
    expect(sent[1]).toEqual([
      "今日の復習が 1 問あります。Web の「今日の復習」（/review）で答えましょう。\n\nこのお知らせは、Web のアカウント画面（/account/line）で止められます。",
    ]);
    const { rows } = await db.query(
      `SELECT "reviewNotifiedOn" = (NOW() AT TIME ZONE 'Asia/Tokyo')::date AS today
       FROM "LineLink" WHERE "lineUserId" = $1`,
      [lineUser],
    );
    expect(rows).toEqual([{ today: true }]);

    expect((await runDrain(`Bearer ${cronSecret()}`)).status).toBe(204);
    expect(await pushes()).toHaveLength(2);
  },
);
