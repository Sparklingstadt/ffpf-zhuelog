import {
  adminOwnerId,
  asAdmin,
  createMember,
  expect,
  memberOwnerId,
  test,
} from "./fixtures";

test("an admin acting as a member saves the conversation as the member's", async ({
  page,
  context,
  db,
}) => {
  const accountId = await createMember(
    db,
    "test01",
    "テスト一郎",
    "member-password-1",
  );
  await asAdmin(context);
  await page.goto("/admin/accounts");
  await page.getByRole("button", { name: "この会員として操作" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  const banner = page.getByRole("status").filter({ hasText: "として操作中" });
  await expect(banner).toContainText("テスト一郎");
  await expect(banner).toContainText("test01");

  // The admin's own features stay: the chat is admin-only.
  await page.goto("/chat");
  const input = page.getByLabel("ChatGPTへのメッセージ");
  await input.fill("我今天很忙");
  await input.press("Enter");
  await expect(
    page.getByRole("article", { name: "ChatGPTのメッセージ" }),
  ).toHaveText(["你好！「我今天很忙」ですね。"]);
  await expect(page).toHaveURL((url) => url.searchParams.has("id"));

  await expect
    .poll(async () => {
      const { rows } = await db.query(
        `SELECT "ownerId" FROM "ChatConversation"`,
      );
      return rows.map((row) => row.ownerId);
    })
    .toEqual([memberOwnerId(accountId)]);

  // Back as the admin, the conversation is not theirs.
  await banner.getByRole("button", { name: "管理者に戻る" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/admin/accounts");
  await expect(banner).toHaveCount(0);
  await page.goto("/conversations");
  await expect(page.getByText("まだ会話ノートがありません")).toBeVisible();
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM "ChatConversation" WHERE "ownerId" = $1`,
    [adminOwnerId],
  );
  expect(rows[0].n).toBe(0);
});

test("acting as a member is refused for a member who does not exist", async ({
  page,
  context,
  db,
}) => {
  const accountId = await createMember(
    db,
    "test02",
    "テスト二郎",
    "member-password-1",
  );
  await asAdmin(context);
  await page.goto("/admin/accounts");
  await db.query(`DELETE FROM "PasswordAccount" WHERE id = $1`, [accountId]);
  await page.getByRole("button", { name: "この会員として操作" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/admin/accounts" &&
      url.searchParams.get("actAs") === "failed",
  );
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "この会員として操作できませんでした" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "として操作中" }),
  ).toHaveCount(0);
});
