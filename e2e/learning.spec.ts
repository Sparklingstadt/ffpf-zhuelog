import { asAdmin, asGuest, expect, test, upload } from "./fixtures";

test("unauthenticated pages redirect to signin", async ({ page }) => {
  for (const path of [
    "/",
    "/logs",
    "/logs/2026/9/20",
    "/logs/2026/9/20/1",
    "/chat",
    "/practice",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/signin(?:\?|$)/);
    await expect(
      page.getByRole("button", { name: "ゲストとして閲覧" }),
    ).toBeVisible();
  }
});

test("guest signs in, cannot post or use chat, and can sign out", async ({
  page,
}) => {
  await asGuest(page);
  await expect(
    page.getByText("共有ノートは閲覧専用", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("まだ学習文がありません")).toBeVisible();
  await expect(page.getByLabel("CSVファイル", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "ChatGPTと話す" })).toHaveCount(
    0,
  );
  const response = await page.request.post("/api/chat", {
    data: { messages: [] },
  });
  expect(response.status()).toBe(403);
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(
    page.getByRole("button", { name: "ゲストとして閲覧" }),
  ).toBeVisible();
  await page.goto("/logs");
  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
});

test("guest callback rejects external redirects", async ({ page }) => {
  await asGuest(page, "https://example.com/unsafe");
  await expect(page).toHaveURL("http://127.0.0.1:3107/");
});

test("CSV persists variable hints, quoted fields and survives reload", async ({
  context,
  page,
  db,
}) => {
  await asAdmin(context);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "対応するCSV形式" }),
  ).toBeVisible();
  await upload(
    page,
    '\uFEFF最初の文,添削後の文,ピン音,ヒント1,ヒント2\n"最初の文A","添削A","pīn,yīn","引用符""のヒント","複数行\nヒント"\n最初の文B,添削B,pinyin\n最初の文C,添削C,pinyin,ヒントC,,ヒントD',
  );
  await expect(page.getByText("3件の学習文を登録しました。")).toBeVisible();
  await page.reload();
  await expect(page.locator("details")).toHaveCount(3);
  await expect(page.getByText("pīn,yīn", { exact: true })).toBeVisible();
  await expect(
    page.getByText('引用符"のヒント', { exact: true }),
  ).toBeVisible();
  expect(
    (await db.query('SELECT count(*)::int AS n FROM "LearningEntry"')).rows[0]
      .n,
  ).toBe(3);
  expect(
    (await db.query('SELECT count(*)::int AS n FROM "Hint"')).rows[0].n,
  ).toBe(4);
  const card = page
    .locator("details")
    .filter({ has: page.getByText("添削A", { exact: true }) });
  await card.locator("summary").click();
  await expect(card.getByText("添削A", { exact: true })).toBeHidden();
  await card.locator("summary").click();
  await expect(card.getByText("添削A", { exact: true })).toBeVisible();
});

for (const [name, csv, error] of [
  ["missing columns", "原文,添削", "3列未満"],
  ["missing required value", "原文,,pinyin", "必須"],
  ["unclosed quote", '"原文,添削,pinyin', "引用符"],
  ["header only", "最初の文,添削後の文,ピン音", "データ行がありません"],
  ["row limit", Array(1001).fill("原文,添削,pinyin").join("\n"), "1000件まで"],
  ["valid then invalid row", "原文,添削,pinyin\n不正な行", "3列未満"],
]) {
  test(`invalid CSV: ${name} writes nothing`, async ({ context, page, db }) => {
    await asAdmin(context);
    await page.goto("/");
    await upload(page, csv);
    await expect(page.getByText("インポートできませんでした")).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "インポートできませんでした" }),
    ).toContainText(error);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM "ImportBatch"')).rows[0]
        .n,
    ).toBe(0);
  });
}

test("stale admin form is rejected after switching to guest", async ({
  context,
  page,
  db,
}) => {
  await asAdmin(context);
  await page.goto("/");
  await expect(page.getByLabel("CSVファイル", { exact: true })).toBeEnabled();
  // Drain initial prefetch responses before replacing the shared session;
  // Auth.js proxy responses refresh cookies, including in-flight requests.
  await page.waitForLoadState("networkidle");
  await context.clearCookies();
  const guestTab = await context.newPage();
  await asGuest(guestTab);
  await upload(page, "原文,添削,pinyin");
  await expect(
    page.getByText(
      "この操作を行う権限がありません。再度ログインしてください。",
    ),
  ).toBeVisible();
  expect(
    (await db.query('SELECT count(*)::int AS n FROM "ImportBatch"')).rows[0].n,
  ).toBe(0);
});

for (const [name, bytes, error] of [
  ["empty.csv", 0, "CSVファイルを選択"],
  ["wrong.txt", 10, "拡張子が.csv"],
  ["large.csv", 5 * 1024 * 1024 + 1, "5MB以下"],
] as const) {
  test(`rejects upload ${name}`, async ({ page, context, db }) => {
    await asAdmin(context);
    await page.goto("/");
    await page.getByLabel("CSVファイル", { exact: true }).setInputFiles({
      name,
      mimeType: "text/csv",
      buffer: Buffer.alloc(bytes, "a"),
    });
    await page
      .getByRole("button", { name: "CSVをインポート", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "インポートできませんでした" }),
    ).toContainText(error);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM "ImportBatch"')).rows[0]
        .n,
    ).toBe(0);
  });
}

test("guest navigates date, detail and adjacent notes with JST grouping", async ({
  page,
  db,
}) => {
  await db.query(
    `INSERT INTO "ImportBatch" (id, "fileName", "rowCount") VALUES ('e2e-batch', 'fixture.csv', 3)`,
  );
  for (const [id, date] of [
    ["1", "2026-09-19T14:59:59Z"],
    ["2", "2026-09-19T15:00:00Z"],
    ["3", "2026-09-20T01:00:00Z"],
  ]) {
    await db.query(
      'INSERT INTO "LearningEntry" (id, "originalText", "correctedText", pinyin, "createdAt", "batchId") VALUES ($1,$2,$3,$4,$5,$6)',
      [id, `原文${id}`, `添削${id}`, "pinyin", date, "e2e-batch"],
    );
  }
  await asGuest(page, "/logs");
  await page.getByRole("link", { name: /2026\/9\/20/ }).click();
  await expect(page.locator("details")).toHaveCount(2);
  await page.getByRole("link", { name: "詳細を開く" }).first().click();
  await expect(page).toHaveURL(/\/logs\/2026\/9\/20\/1$/);
  await expect(page.getByText("添削2", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "次のノート" }).click();
  await expect(page).toHaveURL(/\/logs\/2026\/9\/20\/2$/);
  await page.getByRole("link", { name: "前のノート" }).click();
  await expect(page).toHaveURL(/\/logs\/2026\/9\/20\/1$/);
  for (const path of [
    "/logs/2026/2/30",
    "/logs/2026/9/20/0",
    "/logs/2026/9/20/99",
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
});

test("admin chat is disabled without an API key", async ({ page, context }) => {
  await asAdmin(context);
  await page.goto("/chat");
  await expect(page.getByRole("heading", { name: "会話練習" })).toBeVisible();
  const response = await page.request.post("/api/chat", {
    data: { messages: [] },
  });
  expect(response.status()).toBe(503);
});
