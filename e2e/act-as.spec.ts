import {
  adminOwnerId,
  asAdmin,
  createMember,
  expect,
  memberOwnerId,
  seedNotes,
  test,
  upload,
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

test("an admin acting as a member imports into the member's notes", async ({
  page,
  context,
  db,
}) => {
  const accountId = await createMember(
    db,
    "test03",
    "テスト三郎",
    "member-password-1",
  );
  await asAdmin(context);
  await page.goto("/admin/accounts");
  await page.getByRole("button", { name: "この会員として操作" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(
    page.getByRole("status").filter({ hasText: "として操作中" }),
  ).toContainText("テスト三郎");

  await upload(
    page,
    "原文1,添削1,pinyin 1,ヒントA,ヒントB\n原文2,添削2,pinyin 2",
    "member-notes.csv",
  );
  await expect(page.getByText("2件の学習文を登録しました。")).toBeVisible();

  const entries = await db.query(
    `SELECT "originalText", "ownerId", "batchId",
            (extract(epoch FROM "createdAt") * 1000)::bigint::text AS ms
       FROM "LearningEntry" ORDER BY "originalText"`,
  );
  expect(entries.rows.map((row) => [row.originalText, row.ownerId])).toEqual([
    ["原文1", memberOwnerId(accountId)],
    ["原文2", memberOwnerId(accountId)],
  ]);
  // The first row is the older one, by exactly 1 ms.
  expect(Number(entries.rows[1].ms) - Number(entries.rows[0].ms)).toBe(1);

  const batches = await db.query(
    `SELECT id, "fileName", "rowCount" FROM "ImportBatch"`,
  );
  expect(batches.rows).toEqual([
    { id: entries.rows[0].batchId, fileName: "member-notes.csv", rowCount: 2 },
  ]);
  expect(entries.rows[1].batchId).toBe(entries.rows[0].batchId);

  const hints = await db.query(
    `SELECT h.content, h.position FROM "Hint" h
       JOIN "LearningEntry" e ON e.id = h."learningEntryId"
      WHERE e."originalText" = '原文1' ORDER BY h.position`,
  );
  expect(hints.rows).toEqual([
    { content: "ヒントA", position: 0 },
    { content: "ヒントB", position: 1 },
  ]);
  expect(
    (await db.query('SELECT count(*)::int AS n FROM "Hint"')).rows[0].n,
  ).toBe(2);
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

test("an admin acting as a member reviews the member's queue", async ({
  page,
  context,
  db,
}) => {
  const accountId = await createMember(
    db,
    "test04",
    "テスト四郎",
    "member-password-1",
  );
  const member = memberOwnerId(accountId);
  await seedNotes(db, member, [
    { text: "我昨天去学校了。", createdAt: "2026-10-04T01:00:00Z" },
  ]);
  await asAdmin(context);
  await page.goto("/admin/accounts");
  await page.getByRole("button", { name: "この会員として操作" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(
    page.getByRole("status").filter({ hasText: "として操作中" }),
  ).toContainText("テスト四郎");

  await page.getByRole("button", { name: "復習に入れる" }).click();
  await expect(
    page.getByRole("button", { name: "復習から外す" }),
  ).toBeVisible();
  await page.goto("/review");
  await page.getByRole("button", { name: "めくる" }).click();
  await page
    .getByRole("group", { name: "思い出せた度合い" })
    .getByRole("button", { name: /^できた/ })
    .click();
  await expect(page.getByText("1問 復習しました")).toBeVisible();

  const items = await db.query(`SELECT "ownerId", reps FROM "ReviewItem"`);
  expect(items.rows).toEqual([{ ownerId: member, reps: 1 }]);
  const logs = await db.query(`SELECT "ownerId", rating FROM "ReviewLog"`);
  expect(logs.rows).toEqual([{ ownerId: member, rating: 3 }]);
  const own = await db.query(
    `SELECT count(*)::int AS n FROM "ReviewItem" WHERE "ownerId" = $1`,
    [adminOwnerId],
  );
  expect(own.rows[0].n).toBe(0);
});
