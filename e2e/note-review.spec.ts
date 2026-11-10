import { adminOwnerId, asAdmin, expect, seedNotes, test } from "./fixtures";

// 2026-10-04 in JST: the note is #1 of that day.
const notePath = "/logs/2026/10/4/1";
const note = {
  text: "我昨天去学校了。",
  createdAt: "2026-10-04T01:00:00Z",
  hint: "了の位置",
};

test("a learning note put in review comes back as a card and can be taken out", async ({
  page,
  context,
  db,
}) => {
  await seedNotes(db, adminOwnerId, [note]);
  await asAdmin(context);

  await page.goto(notePath);
  await page.getByRole("button", { name: "復習に入れる" }).click();
  await expect(page.getByText("今日の復習に入っています")).toBeVisible();

  // On the review page the note is a card: the sentence as written first,
  // the corrected sentence and the hints once turned over.
  await page.goto("/review");
  await expect(
    page.getByRole("main").getByText("学習ノート", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(note.text)).toHaveCount(1);
  await expect(page.getByText(note.hint)).toHaveCount(0);
  await page.getByRole("button", { name: "めくる" }).click();
  await expect(page.getByText(note.hint)).toBeVisible();
  // The keys 1 to 4 answer as the rating buttons do: 4 is 簡単.
  await expect(
    page
      .getByRole("group", { name: "思い出せた度合い" })
      .getByRole("button", { name: "簡単" }),
  ).toHaveAttribute("aria-keyshortcuts", "4");
  await page.keyboard.press("4");
  await expect(page.getByText("1問 復習しました")).toBeVisible();

  // Taken out, it is no longer in the queue.
  await page.goto(notePath);
  await page.getByRole("button", { name: "復習から外す" }).click();
  await expect(
    page.getByRole("button", { name: "復習に入れる" }),
  ).toBeVisible();
  await expect(page.getByText("今日の復習に入っています")).toHaveCount(0);
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM "ReviewItem" WHERE "ownerId" = $1 AND "kind" = 'entry'`,
    [adminOwnerId],
  );
  expect(rows[0].n).toBe(0);
});

test("a note in the trash leaves the review until it is restored", async ({
  page,
  context,
  db,
}) => {
  await seedNotes(db, adminOwnerId, [note]);
  await asAdmin(context);
  await page.goto(notePath);
  await page.getByRole("button", { name: "復習に入れる" }).click();
  await expect(page.getByText("今日の復習に入っています")).toBeVisible();

  await page.getByRole("button", { name: "ゴミ箱に入れる" }).click();
  await expect(page).toHaveURL(/trashed=1/);
  await page.goto("/review");
  await expect(page.getByText("今日の復習はありません")).toBeVisible();

  await page.goto("/logs/trash");
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("ゴミ箱は空です")).toBeVisible();
  await page.goto("/review");
  await expect(
    page.getByRole("main").getByText("学習ノート", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(note.text)).toHaveCount(1);
});

test("space rates a turned card as suggested, and the last card says so", async ({
  page,
  context,
  db,
}) => {
  await seedNotes(db, adminOwnerId, [note]);
  await asAdmin(context);
  await page.goto(notePath);
  await page.getByRole("button", { name: "復習に入れる" }).click();
  await expect(page.getByText("今日の復習に入っています")).toBeVisible();

  await page.goto("/review");
  await expect(page.getByText("最後の1問")).toBeVisible();
  await page.getByRole("button", { name: "めくる" }).click();
  const suggested = page
    .getByRole("group", { name: "思い出せた度合い" })
    .getByRole("button", { name: "できた" });
  await expect(suggested).toHaveAttribute("aria-keyshortcuts", "3 Space");
  // Away from the buttons, so the page's own key is what answers.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press("Space");
  await expect(page.getByText("1問 復習しました")).toBeVisible();
  const { rows } = await db.query(
    `SELECT "rating" FROM "ReviewLog" WHERE "ownerId" = $1`,
    [adminOwnerId],
  );
  expect(rows).toEqual([{ rating: 3 }]);
});
