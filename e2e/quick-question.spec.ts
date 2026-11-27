import type { Page, Request } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { openAiStubURL } from "./environment";
import {
  adminOwnerId,
  anyWidth,
  asAdmin,
  asGuest,
  asMember,
  createMember,
  expect,
  test,
} from "./fixtures";

const FAILURE = "ChatGPTから応答を受信できませんでした。";

test("one quick question saves a private note and the next starts fresh", async ({
  page,
  context,
  db,
}, testInfo) => {
  await asAdmin(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/quick-question");
  const input = page.getByLabel("クイック質問の内容");
  await input.fill("了と过の違いは？");
  await input.press("Enter");
  await expect(page.getByText("質問ノートに保存しました。")).toBeVisible();
  await expect(input).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: "ChatGPTのメッセージ" }),
  ).toHaveText("你好！「了と过の違いは？」ですね。");
  expect(
    (await db.query('SELECT count(*)::int AS n FROM "ChatConversation"'))
      .rows[0].n,
  ).toBe(0);
  const { rows } = await db.query('SELECT * FROM "QuickQuestion"');
  expect(rows).toHaveLength(1);
  expect(rows[0].userId).toBe(adminOwnerId);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("quick-question-390.png"),
  });
  await page.getByRole("link", { name: "質問ノートを見る" }).click();
  await expect(page).toHaveURL(/\/questions\/[0-9a-f-]+$/);
  await expect(page.getByRole("article")).toHaveCount(2);
  await page.reload();
  await expect(
    page.getByText("了と过の違いは？", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "質問ノートへ", exact: true }).click();
  await page.getByRole("link", { name: /了と过の違い/ }).click();
  await page.getByRole("link", { name: "新しい質問", exact: true }).click();
  let submitted: unknown;
  await page.route("**/api/quick-question", async (route) => {
    submitted = route.request().postDataJSON();
    await route.continue();
  });
  await input.fill("谢谢の読み方は？");
  await input.press("Enter");
  await expect(page.getByText("質問ノートに保存しました。")).toBeVisible();
  expect(submitted).toEqual({
    messages: [{ role: "user", text: "谢谢の読み方は？" }],
  });
  expect(
    (await db.query('SELECT count(*)::int AS n FROM "QuickQuestion"')).rows[0]
      .n,
  ).toBe(2);
});

test("failed saves retry the same answer once without asking again", async ({
  page,
  context,
  db,
}) => {
  await asAdmin(context);
  await page.goto("/quick-question");
  let fail = true;
  let generations = 0;
  await page.route("**/quick-question", (route) =>
    fail && route.request().headers()["next-action"]
      ? route.abort()
      : route.continue(),
  );
  await page.route("**/api/quick-question", async (route) => {
    generations++;
    await route.continue();
  });
  await page.getByLabel("クイック質問の内容").fill("你好の意味は？");
  await page.getByRole("button", { name: "質問する", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存を再試行" }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "ChatGPTのメッセージ" }),
  ).toContainText("你好の意味は？");
  fail = false;
  await page.getByRole("button", { name: "保存を再試行" }).click();
  await expect(page.getByText("質問ノートに保存しました。")).toBeVisible();
  expect(generations).toBe(1);
  expect(
    (await db.query('SELECT count(*)::int AS n FROM "QuickQuestion"')).rows[0]
      .n,
  ).toBe(1);
  await page
    .getByRole("button", { name: "新しい質問", exact: true })
    .last()
    .click();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("cut answers stay unsaved and can be retried", async ({
  page,
  context,
  db,
}) => {
  await asAdmin(context);
  await page.goto("/quick-question");
  await page.route("**/api/quick-question", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: '{"type":"delta","text":"途中"}\n',
    }),
  );
  const input = page.getByLabel("クイック質問の内容");
  await input.fill("疑問");
  await input.press("Enter");
  await expect(page.getByText(/回答を受信できませんでした/)).toBeVisible();
  await expect(input).toHaveValue("疑問");
  expect(
    (await db.query('SELECT count(*)::int AS n FROM "QuickQuestion"')).rows[0]
      .n,
  ).toBe(0);
});

test(
  "members cannot read another owner's note and guests cannot use quick questions",
  anyWidth,
  async ({ page, context, db, browser }) => {
    await asAdmin(context);
    await page.goto("/quick-question");
    await page.getByLabel("クイック質問の内容").fill("管理者の質問");
    await page.getByRole("button", { name: "質問する", exact: true }).click();
    await expect(page.getByText("質問ノートに保存しました。")).toBeVisible();
    const { rows } = await db.query('SELECT id FROM "QuickQuestion"');
    await createMember(db, "quick-member", "質問者", "member-password-1");
    const member = await browser.newPage();
    await asMember(member, "quick-member", "member-password-1");
    expect((await member.goto(`/questions/${rows[0].id}`))?.status()).toBe(404);
    await member.goto("/questions");
    await expect(member.getByText("まだ質問ノートがありません")).toBeVisible();
    await member.goto("/quick-question");
    await member.getByLabel("クイック質問の内容").fill("メンバーの質問");
    await member.getByRole("button", { name: "質問する", exact: true }).click();
    await expect(member.getByText("質問ノートに保存しました。")).toBeVisible();
    await member.close();
    const guest = await browser.newPage();
    await asGuest(guest);
    for (const path of [
      "/quick-question",
      "/questions",
      `/questions/${rows[0].id}`,
    ])
      expect((await guest.goto(path))?.status()).toBe(404);
    await guest.close();
  },
);

// e2e/openai-stub.ts cuts an answer at "[incomplete]" (after one piece, with
// usage) and refuses one at "[fail]" (500, no usage). Neither is saved; the
// cut one is still billed.
test("an answer OpenAI cuts or refuses is not saved", async ({
  page,
  context,
  db,
}) => {
  await asAdmin(context);
  await page.goto("/quick-question");
  const input = page.getByLabel("クイック質問の内容");
  const answered = () =>
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/quick-question",
    );

  let response = answered();
  await input.fill("[incomplete] 了？");
  await input.press("Enter");
  // Cut after text: a 200 whose last line is the error.
  expect((await response).status()).toBe(200);
  await expect(page.getByText(FAILURE)).toBeVisible();
  await expect(
    page.getByRole("article", { name: "ChatGPTのメッセージ" }),
  ).toContainText("你好！");
  await expect(input).toHaveValue("[incomplete] 了？");

  response = answered();
  await input.fill("[fail] 了？");
  await input.press("Enter");
  // Refused before any text: a 502 with a JSON error body.
  const refused = await response;
  expect(refused.status()).toBe(502);
  expect(await refused.json()).toEqual({
    error: { code: "chat_failed", message: FAILURE },
  });
  await expect(page.getByText(FAILURE)).toBeVisible();
  await expect(input).toHaveValue("[fail] 了？");

  expect(
    (await db.query('SELECT count(*)::int AS n FROM "QuickQuestion"')).rows[0]
      .n,
  ).toBe(0);
  const { rows } = await db.query(
    `SELECT "userId", "model", "inputTokens", "outputTokens" FROM "AiUsage"
      WHERE "feature" = 'quick_question'`,
  );
  expect(rows).toEqual([
    {
      userId: adminOwnerId,
      model: "gpt-6.1-sol",
      inputTokens: 21,
      outputTokens: 43,
    },
  ]);
});

// Keeps the Server Action POST that saves the note, to send it again.
function captureSave(page: Page) {
  const saves: Request[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/quick-question" &&
      request.headers()["next-action"]
    )
      saves.push(request);
  });
  return saves;
}

// A note id is the browser's: sending the same note again is fine, but the
// same id with another answer, or from another member, changes nothing.
test(
  "a question note id cannot be overwritten",
  anyWidth,
  async ({ page, context, db, browser }) => {
    await asAdmin(context);
    await page.goto("/quick-question");
    const saves = captureSave(page);
    await page.getByLabel("クイック質問の内容").fill("了と过の違いは？");
    await page.getByRole("button", { name: "質問する", exact: true }).click();
    await expect(page.getByText("質問ノートに保存しました。")).toBeVisible();
    expect(saves).toHaveLength(1);
    const [save] = saves;
    const notes =
      'SELECT "id", "userId", "answer", "createdAt" FROM "QuickQuestion"';
    const { rows: before } = await db.query(notes);
    expect(before).toHaveLength(1);
    expect(before[0].userId).toBe(adminOwnerId);

    const retry = await page.request.fetch(save);
    expect(retry.status()).toBe(200);
    expect(await retry.text()).toContain('{"ok":true}');
    expect((await db.query(notes)).rows).toEqual(before);

    const body = save.postData() ?? "";
    expect(body).toContain(before[0].answer);
    const headers = save.headers();
    const sendAs = (requester: Page, data: string) =>
      requester.request.post(save.url(), {
        headers: {
          "next-action": headers["next-action"],
          "content-type": headers["content-type"],
          accept: headers["accept"],
        },
        data,
      });
    const changed = await sendAs(
      page,
      body.replace(before[0].answer, "書き換え"),
    );
    expect(await changed.text()).toContain(
      "処理できませんでした。時間をおいてもう一度お試しください。",
    );
    expect((await db.query(notes)).rows).toEqual(before);

    await createMember(db, "quick-member", "質問者", "member-password-1");
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await asMember(otherPage, "quick-member", "member-password-1");
    const stolen = await sendAs(otherPage, body);
    expect(await stolen.text()).toContain(
      "処理できませんでした。時間をおいてもう一度お試しください。",
    );
    expect((await db.query(notes)).rows).toEqual(before);
    await other.close();
  },
);

// Stopping an answer closes the browser's request; the web then stops its
// own request to OpenAI. e2e/openai-stub.ts holds a "[hang]" answer open
// after one piece and reports whether its caller closed the connection.
// The stopped question is not sent again.
test("stopping an answer stops the request to OpenAI", async ({
  page,
  context,
  db,
  request,
}) => {
  await asAdmin(context);
  await page.goto("/quick-question");
  const question = `[hang] ${randomUUID()}`;
  const state = async () => {
    const response = await request.get(
      `${openAiStubURL}/e2e/streams?message=${encodeURIComponent(question)}`,
    );
    return ((await response.json()) as { state: string }).state;
  };

  let asked = 0;
  page.on("request", (sent) => {
    if (new URL(sent.url()).pathname === "/api/quick-question") asked++;
  });

  const input = page.getByLabel("クイック質問の内容");
  await input.fill(question);
  await page.getByRole("button", { name: "質問する", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "ChatGPTのメッセージ" }),
  ).toContainText("你好！");
  expect(await state()).toBe("open");

  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.getByText(/回答を停止しました/)).toBeVisible();
  await expect(input).toHaveValue(question);
  await expect(
    page.getByRole("button", { name: "質問する", exact: true }),
  ).toBeEnabled();
  // Well before the stub's own 30 s end.
  await expect.poll(state, { timeout: 10_000 }).toBe("closed");
  expect(asked).toBe(1);
  expect(
    (await db.query('SELECT count(*)::int AS n FROM "QuickQuestion"')).rows[0]
      .n,
  ).toBe(0);
});
