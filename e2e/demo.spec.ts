import { expect, memberOwnerId, test, upload } from "./fixtures";
import { demoLoginId, goApiURL, goCronSecret } from "./environment";

// Puts the demo account back to its fixture, as the nightly cron does. The
// db fixture empties the accounts before every test, so it runs each time.
async function resetDemo() {
  const response = await fetch(`${goApiURL}/v1/cron/demo-reset`, {
    method: "POST",
    headers: { authorization: `Bearer ${goCronSecret()}` },
  });
  expect(response.status).toBe(204);
}

test("the demo reset needs the cron secret", async () => {
  const response = await fetch(`${goApiURL}/v1/cron/demo-reset`, {
    method: "POST",
    headers: { authorization: "Bearer wrong" },
  });
  expect(response.status).toBe(401);
});

test("anyone can try the members' pages in the demo, without AI", async ({
  page,
}) => {
  await resetDemo();
  await page.goto("/signin");
  const demoButton = page.getByRole("button", { name: "デモで試す" });
  await expect(demoButton).toBeVisible();
  await expect(
    page.getByText("データは試している全員で共有され、毎晩元に戻ります。", {
      exact: false,
    }),
  ).toBeVisible();
  await demoButton.click();

  // Every page says it is the demo.
  await expect(page).toHaveURL(/\/$/);
  const banner = page.getByRole("status", { name: "デモアカウント" });
  await expect(banner).toContainText("デモアカウントです。");

  // The fixture's notes, reviews, words and conversations are there.
  await expect(page.getByTestId("review-due-count")).not.toHaveText("0");
  await expect(
    page.getByText("明日の会議は午後三時からです。").first(),
  ).toBeVisible();
  await page.goto("/logs");
  // Notes on several of the last seven days.
  await expect(page.getByText("2件の学習ノート").first()).toBeVisible();
  await expect(banner).toBeVisible();
  await page.goto("/vocabulary");
  await expect(page.getByText("图书馆", { exact: true }).first()).toBeVisible();
  await page.goto("/conversations");
  // Two days with a conversation each; the newest is the weekend plans.
  await expect(page.getByText("1件の会話")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "ChatGPT と話す" })).toHaveCount(
    0,
  );
  await page.getByText("1件の会話").first().click();
  await expect(page.getByText("週末の予定を話す")).toBeVisible();

  // The menu leaves out the AI features, follows, LINE and the password.
  await page
    .getByRole("banner")
    .getByRole("button", { name: /のメニュー$/ })
    .click();
  const menu = page.getByRole("menu", { name: "メニュー" });
  await expect(
    menu.getByRole("menuitem", { name: "会話ノート" }),
  ).toBeVisible();
  for (const name of [
    "ChatGPT と話す",
    "クイック質問",
    "フォロー",
    "LINE 連携",
    "パスワード変更",
  ])
    await expect(menu.getByRole("menuitem", { name })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Go refuses the AI routes to the demo, even when called directly.
  const answer = await page.evaluate(async () => {
    const response = await fetch("/api/quick-question", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", text: "你好" }] }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(answer.status).toBe(403);
  expect(answer.body.error.message).toBe("デモでは使えません。");

  // Leaving the demo signs out.
  await banner.getByRole("button", { name: "デモを終える" }).click();
  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
});

// The demo is shared by strangers, so it cannot put a note on followers'
// timelines: the share button answers as for anyone who may not share.
test("the demo account cannot share", async ({ page, db }) => {
  await resetDemo();
  await page.goto("/signin");
  await page.getByRole("button", { name: "デモで試す" }).click();
  await expect(page).toHaveURL(/\/$/);

  // The demo's newest note: the last of its JST day.
  const { rows } = await db.query(
    `SELECT "correctedText", ("createdAt" + interval '9 hours')::date::text AS day
       FROM "LearningEntry" WHERE "deletedAt" IS NULL
      ORDER BY "createdAt" ASC, id ASC`,
  );
  const day = rows.at(-1).day as string;
  const sameDay = rows.filter((row) => row.day === day);
  const [year, month, date] = day.split("-").map(Number);
  await page.goto(`/logs/${year}/${month}/${date}/${sameDay.length}`);
  await expect(
    page.getByText(rows.at(-1).correctedText, { exact: true }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "共有する" }).click();
  await expect(page.getByText("ログインし直してください。")).toBeVisible();
  const shared = await db.query(
    `SELECT count(*)::int AS n FROM "LearningEntry" WHERE "sharedAt" IS NOT NULL`,
  );
  expect(shared.rows[0].n).toBe(0);
});

test("the demo account can import CSV", async ({ page, db }) => {
  await resetDemo();
  await page.goto("/signin");
  await page.getByRole("button", { name: "デモで試す" }).click();
  await expect(page).toHaveURL(/\/$/);

  await upload(page, "デモの原文,デモの添削,demo pinyin");
  await expect(page.getByText("1件の学習文を登録しました。")).toBeVisible();

  const account = await db.query(
    `SELECT id FROM "PasswordAccount" WHERE "loginId" = $1`,
    [demoLoginId],
  );
  const { rows } = await db.query(
    `SELECT "ownerId" FROM "LearningEntry" WHERE "originalText" = 'デモの原文'`,
  );
  expect(rows).toEqual([{ ownerId: memberOwnerId(account.rows[0].id) }]);
});
