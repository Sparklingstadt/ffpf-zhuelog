import {
  asGuest,
  asMember,
  createMember,
  expect,
  memberOwnerId,
  test,
} from "./fixtures";

test("a word added to the book comes up as a flashcard and can be removed", async ({
  page,
  db,
}) => {
  const accountId = await createMember(db, "taro", "太郎", "member-password-1");
  const owner = memberOwnerId(accountId);
  await asMember(page, "taro", "member-password-1");

  await page.goto("/vocabulary");
  await expect(page.getByText("まだ単語がありません。")).toBeVisible();
  await page.getByLabel("語句").fill("认真");
  await page.getByLabel("ピンイン").fill("rènzhēn");
  await page.getByLabel("意味").fill("まじめに");
  await page.getByRole("button", { name: "単語帳に入れる" }).click();
  await expect(page.getByText("「认真」を単語帳に入れました。")).toBeVisible();
  const list = page.getByRole("region", { name: "単語の一覧" });
  await expect(list).toContainText("认真");
  await expect(list).toContainText("まじめに");

  // The same word again is refused.
  await page.getByLabel("語句").fill("认真");
  await page.getByLabel("意味").fill("別の意味");
  await page.getByRole("button", { name: "単語帳に入れる" }).click();
  await expect(
    page.getByText("この語句はすでに単語帳にあります。"),
  ).toBeVisible();

  const { rows: items } = await db.query(
    `SELECT i."kind", i."targetId" = v."id" AS "same" FROM "ReviewItem" i
     JOIN "VocabularyEntry" v ON v."ownerId" = i."ownerId" WHERE i."ownerId" = $1`,
    [owner],
  );
  expect(items).toEqual([{ kind: "vocabulary", same: true }]);

  await page.goto("/");
  await expect(page.getByTestId("review-due-count")).toHaveText("1");
  await page.getByRole("link", { name: "復習する" }).click();
  await expect(page.getByText("认真", { exact: true })).toBeVisible();
  await expect(page.getByText("まじめに")).toHaveCount(0);
  await page.getByRole("button", { name: "めくる" }).click();
  await expect(page.getByText("まじめに")).toBeVisible();
  await page
    .getByRole("group", { name: "思い出せた度合い" })
    .getByRole("button", { name: "簡単" })
    .click();
  await expect(page.getByText("1問 復習しました")).toBeVisible();

  await page.goto("/vocabulary");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "消す" }).click();
  await expect(page.getByText("まだ単語がありません。")).toBeVisible();
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM "ReviewItem" WHERE "ownerId" = $1`,
    [owner],
  );
  expect(rows).toEqual([{ n: 0 }]);
});

test("guests have no vocabulary book", async ({ page }) => {
  await asGuest(page);
  await page.goto("/vocabulary");
  await expect(page).toHaveURL((url) => url.pathname === "/");
});
