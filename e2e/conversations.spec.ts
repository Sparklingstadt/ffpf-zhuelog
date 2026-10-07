import { asAdmin, asGuest, expect, seedConversation, test } from "./fixtures";

test("admin browses own saved conversations by JST date", async ({
  page,
  context,
  db,
}) => {
  // 2026-10-03 15:30 UTC is already 2026-10-04 in JST.
  await seedConversation(db, 1, "10001", "2026-10-03T15:30:00Z", "会話1", [
    ["user", "我昨天去图书馆了。自然ですか？"],
    ["assistant", "「我昨天去了图书馆。」のほうが自然です。"],
  ]);
  await seedConversation(db, 2, "10001", "2026-10-04T02:00:00Z", "会話2", [
    ["user", "你好"],
    ["assistant", "你好！今天想聊什么？"],
    ["user", "天气"],
    ["assistant", "今天天气怎么样？"],
  ]);
  await seedConversation(db, 3, "20002", "2026-10-04T03:00:00Z", "他人の会話", [
    ["user", "秘密"],
    ["assistant", "了解"],
  ]);
  await asAdmin(context);

  await page.goto("/");
  await page.getByRole("link", { name: "会話ノート" }).click();
  await expect(page).toHaveURL(/\/conversations$/);
  await expect(page.getByText("2件の会話ノート")).toBeVisible();
  await page.getByRole("link", { name: /2026\/10\/4/ }).click();
  await expect(page).toHaveURL(/\/conversations\/2026\/10\/4$/);
  await expect(
    page.getByRole("heading", { name: "2026年10月4日" }),
  ).toBeVisible();
  await expect(page.getByText("4件のメッセージ")).toBeVisible();
  await expect(page.getByText("他人の会話")).toHaveCount(0);

  await page.getByRole("link", { name: /会話1/ }).click();
  await expect(page).toHaveURL(/\/conversations\/2026\/10\/4\/1$/);
  await expect(
    page.getByRole("article", { name: "あなたのメッセージ" }),
  ).toHaveText("我昨天去图书馆了。自然ですか？");
  await expect(
    page.getByRole("article", { name: "ChatGPTのメッセージ" }),
  ).toHaveText("「我昨天去了图书馆。」のほうが自然です。");
  await page.getByRole("link", { name: "次のノート" }).click();
  await expect(page).toHaveURL(/\/conversations\/2026\/10\/4\/2$/);
  await expect(
    page.getByRole("article", { name: "ChatGPTのメッセージ" }),
  ).toHaveCount(2);
  await expect(page.getByRole("link", { name: "次のノート" })).toHaveCount(0);

  for (const path of [
    "/conversations/2026/2/30",
    "/conversations/2026/10/4/0",
    "/conversations/2026/10/4/3",
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
});

test("conversation notes are hidden from guests", async ({ page, db }) => {
  await seedConversation(db, 1, "10001", "2026-10-04T02:00:00Z", "非公開", [
    ["user", "秘密"],
    ["assistant", "了解"],
  ]);
  await asGuest(page);
  await expect(page.getByRole("link", { name: "会話ノート" })).toHaveCount(0);
  for (const path of ["/conversations", "/conversations/2026/10/4/1"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
  }
  await expect(page.getByText("非公開")).toHaveCount(0);
});

test("admin starts with no conversation notes", async ({ page, context }) => {
  await asAdmin(context);
  await page.goto("/conversations");
  await expect(page.getByText("まだ会話ノートがありません")).toBeVisible();
});
