import {
  asAdmin,
  asGuest,
  asMember,
  createMember,
  expect,
  test,
} from "./fixtures";

test("admin chats, the conversation is saved and can be continued and deleted", async ({
  page,
  context,
}) => {
  await asAdmin(context);
  await page.goto("/");
  await page
    .getByRole("main")
    .getByRole("link", { name: "ChatGPT と話す" })
    .click();
  await expect(page).toHaveURL((url) => url.pathname === "/chat");

  const input = page.getByLabel("ChatGPTへのメッセージ");
  await input.fill("我今天很忙");
  await input.press("Enter");
  const answers = page.getByRole("article", { name: "ChatGPTのメッセージ" });
  await expect(answers).toHaveText(["你好！「我今天很忙」ですね。"]);
  // Saved after the answer: the URL now names the conversation.
  await expect(page).toHaveURL((url) => url.searchParams.has("id"));

  await page.getByRole("link", { name: "会話ノート" }).first().click();
  await expect(page).toHaveURL((url) => url.pathname === "/conversations");
  await page.getByText("1件の会話").click();
  await page.getByText("#1 我今天很忙").click();
  await expect(page.getByRole("heading", { name: "我今天很忙" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);

  await page.getByRole("link", { name: "続きを話す" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/chat");
  await expect(answers).toHaveCount(1);
  await input.fill("明天见");
  await input.press("Enter");
  await expect(answers).toHaveText([
    "你好！「我今天很忙」ですね。",
    "你好！「明天见」ですね。",
  ]);

  await page.goto("/conversations");
  await page.getByText("1件の会話").click();
  await page.getByText("#1 我今天很忙").click();
  await expect(page.getByRole("article")).toHaveCount(4);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/conversations");
  await expect(page.getByText("まだ会話ノートがありません")).toBeVisible();
});

test("members and guests have no way in", async ({ page, db, browser }) => {
  await createMember(db, "taro", "太郎", "member-password-1");
  await asMember(page, "taro", "member-password-1");
  await expect(page.getByRole("link", { name: "ChatGPT と話す" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: "会話ノート" })).toHaveCount(0);
  expect((await page.goto("/chat"))?.status()).toBe(404);
  expect((await page.goto("/conversations"))?.status()).toBe(404);

  const guest = await browser.newPage();
  await asGuest(guest);
  await expect(guest.getByRole("link", { name: "ChatGPT と話す" })).toHaveCount(
    0,
  );
  expect((await guest.goto("/chat"))?.status()).toBe(404);
  expect((await guest.goto("/conversations"))?.status()).toBe(404);
  await guest.close();
});
