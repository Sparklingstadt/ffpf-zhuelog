import {
  asAdmin,
  asGuest,
  asMember,
  createMember,
  expect,
  test,
} from "./fixtures";

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
  expect(rows[0].ownerId).toBe("10001");
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

test("members cannot read another owner's note and guests cannot use quick questions", async ({
  page,
  context,
  db,
  browser,
}) => {
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
});
