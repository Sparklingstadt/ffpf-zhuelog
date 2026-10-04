import type { Client } from "pg";
import { asAdmin, asGuest, expect, test } from "./fixtures";

async function seedNote(
  db: Client,
  id: string,
  createdAt: string,
  title: string,
  messages: [role: "user" | "assistant", content: string][],
) {
  await db.query(
    `INSERT INTO "ConversationNote" ("id", "title", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $3)`,
    [id, title, createdAt],
  );
  for (const [position, [role, content]] of messages.entries()) {
    await db.query(
      `INSERT INTO "ConversationMessage" ("id", "role", "content", "position", "noteId")
       VALUES ($1, $2, $3, $4, $5)`,
      [`${id}-${position}`, role, content, position, id],
    );
  }
}

test("admin browses saved conversation notes by JST date", async ({
  page,
  context,
  db,
}) => {
  // 2026-10-03 15:30 UTC is already 2026-10-04 in JST.
  await seedNote(db, "conversation-1", "2026-10-03T15:30:00Z", "会話1", [
    ["user", "我昨天去图书馆了。自然ですか？"],
    ["assistant", "「我昨天去了图书馆。」のほうが自然です。"],
  ]);
  await seedNote(db, "conversation-2", "2026-10-04T02:00:00Z", "会話2", [
    ["user", "你好"],
    ["assistant", "你好！今天想聊什么？"],
    ["user", "天气"],
    ["assistant", "今天天气怎么样？"],
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
  await seedNote(db, "private", "2026-10-04T02:00:00Z", "非公開の会話", [
    ["user", "秘密"],
    ["assistant", "了解"],
  ]);
  await asGuest(page);
  await expect(page.getByRole("link", { name: "会話ノート" })).toHaveCount(0);
  for (const path of ["/conversations", "/conversations/2026/10/4/1"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
  }
  await expect(page.getByText("非公開の会話")).toHaveCount(0);
});

test("admin starts with no conversation notes and nothing to save", async ({
  page,
  context,
}) => {
  await asAdmin(context);
  await page.goto("/conversations");
  await expect(page.getByText("まだ会話ノートがありません")).toBeVisible();
  await page.goto("/chat");
  await expect(
    page.getByRole("button", { name: "会話ノートに保存" }),
  ).toBeDisabled();
});
