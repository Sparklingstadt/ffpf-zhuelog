import { asGuest, expect, test } from "./fixtures";

const key = "sk-test-only-never-a-real-key-123456";
const historyKey = "zhuelog:personal-practice:v1";
const result = {
  originalText: "今天我很busy。",
  correctedText: "今天我很忙。",
  pinyin: "Jīntiān wǒ hěn máng.",
  hints: ["忙=忙しい", "英語のbusyを忙に置き換えます。"],
};
async function register(page: import("@playwright/test").Page) {
  await page
    .getByLabel(
      "自分のAPIキーを使用し、本人への課金・サーバー経由での送信・端末保存に同意します",
    )
    .check();
  await page.getByLabel("OpenAI APIキー", { exact: true }).fill(key);
  await page.getByRole("button", { name: "この画面にキーを登録" }).click();
  await expect(page.getByText("APIキー登録済み（この画面のみ）")).toBeVisible();
}

test("guest BYOK entry, consent, local history, non-persistent key and deletion", async ({
  page,
  db,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/signin");
  await expect(page.getByText(/ChatGPTの定額プランとは別料金/)).toBeVisible();
  await expect(page.getByText(/アプリのDBには保存しません/)).toBeVisible();
  await page
    .getByRole("button", { name: "自分のAPIキーで添削", exact: true })
    .click();
  await expect(page).toHaveURL(/\/practice$/);
  await expect(
    page.getByRole("button", { name: "この画面にキーを登録" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "自分のAPIキーで添削する" }),
  ).toBeDisabled();
  await register(page);
  await page.route("**/api/corrections", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      apiKey: key,
      originalText: result.originalText,
      consent: true,
    });
    await route.fulfill({ json: result });
  });
  await page.getByLabel("添削する中国語").fill(result.originalText);
  await page.getByRole("button", { name: "自分のAPIキーで添削する" }).click();
  await expect(
    page.getByText(result.correctedText, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(result.pinyin)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("practice.png"),
    fullPage: true,
  });
  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    cookie: document.cookie,
  }));
  expect(JSON.stringify(storage)).not.toContain(key);
  expect(JSON.parse(storage.local[historyKey])).toHaveLength(1);
  const { rows } = await db.query(
    'SELECT (SELECT count(*) FROM "LearningEntry") AS notes, (SELECT count(*) FROM "LineLearningJob") AS jobs',
  );
  expect(rows[0]).toEqual({ notes: "0", jobs: "0" });
  await page.reload();
  await expect(
    page.getByText(result.correctedText, { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("OpenAI APIキー", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByRole("button", { name: "自分のAPIキーで添削する" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "履歴をすべて削除" }).click();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(
    page.getByText(result.correctedText, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "履歴をすべて削除" }).click();
  await page.getByRole("button", { name: "削除を確定" }).click();
  await expect(
    page.getByRole("heading", { name: "この端末の添削履歴（0件）" }),
  ).toBeVisible();
  expect(
    await page.evaluate((name) => localStorage.getItem(name), historyKey),
  ).toBeNull();
  await register(page);
  await page.getByRole("button", { name: "キーを解除" }).click();
  await expect(page.getByLabel("OpenAI APIキー", { exact: true })).toHaveValue(
    "",
  );
  await register(page);
  await page.getByRole("link", { name: "学習ノートへ", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3107/");
  await expect(
    page.getByRole("heading", { name: "学习録", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/practice$/);
  await expect(page.getByLabel("OpenAI APIキー", { exact: true })).toHaveValue(
    "",
  );
  await register(page);
  await page.getByRole("button", { name: "ログアウト" }).click();
  await page
    .getByRole("button", { name: "自分のAPIキーで添削", exact: true })
    .click();
  await expect(page.getByLabel("OpenAI APIキー", { exact: true })).toHaveValue(
    "",
  );
  expect(pageErrors).toEqual([]);
});

test("BYOK errors are safe, real route rejects invalid input and cross-origin requests", async ({
  page,
}) => {
  await asGuest(page, "/practice");
  const badOrigin = await page.request.post("/api/corrections", {
    headers: { origin: "https://evil.test" },
    data: { apiKey: key, originalText: "你好", consent: true },
  });
  expect(badOrigin.status()).toBe(403);
  const invalid = await page.evaluate(async () => {
    const response = await fetch("/api/corrections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: "",
        originalText: "你好",
        consent: false,
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(invalid.status).toBe(400);
  await register(page);
  await page.route("**/api/corrections", (route) =>
    route.fulfill({
      status: 422,
      json: { code: "key", error: `raw upstream ${key}` },
    }),
  );
  await page.getByLabel("添削する中国語").fill("你好");
  await page.getByRole("button", { name: "自分のAPIキーで添削する" }).click();
  await expect(
    page.getByText("APIキーが無効か、このモデルを利用する権限がありません。"),
  ).toBeVisible();
  await expect(page.getByLabel("OpenAI APIキー", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.getByText(`raw upstream ${key}`)).toHaveCount(0);
});

test("storage failure retains visible result and long text stays within mobile viewport", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await asGuest(page, "/practice");
  await register(page);
  const longText = "中".repeat(500);
  await page.route("**/api/corrections", (route) =>
    route.fulfill({
      json: {
        ...result,
        originalText: longText,
        correctedText: "中".repeat(1000),
        pinyin: "chang".repeat(200),
      },
    }),
  );
  await page.getByLabel("添削する中国語").fill(longText);
  await page.getByRole("button", { name: "自分のAPIキーで添削する" }).click();
  await expect(page.getByText(/履歴を端末に読み書きできません/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "この端末の添削履歴（1件）" }),
  ).toBeVisible();
  const sizes = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.viewport);
  await page.getByLabel("添削する中国語").fill(longText);
  await page.getByRole("button", { name: "自分のAPIキーで添削する" }).click();
  await expect(
    page.getByRole("heading", { name: "この端末の添削履歴（2件）" }),
  ).toBeVisible();
});
