import {
  asMember,
  createMember,
  expect,
  memberOwnerId,
  openSiteMenu,
  pickUntilRight,
  test,
} from "./fixtures";

const GROUP = "量詞を選ぶ";
const QUESTION_COUNT = 25;
// How many due items /review shows at once (SESSION_SIZE in its page).
const REVIEW_SESSION_SIZE = 20;

test("量詞: 25 questions are saved as mode measure, listed with the complements and reviewed", async ({
  page,
  db,
}) => {
  test.setTimeout(90_000);
  const owner = memberOwnerId(
    await createMember(
      db,
      "measure-learner",
      "量詞学習者",
      "member-password-1",
    ),
  );
  await asMember(page, "measure-learner", "member-password-1");
  const menu = await openSiteMenu(page);
  await menu.getByRole("menuitem", { name: "量詞の練習" }).click();
  await expect(page).toHaveURL(/\/practice\/measure-words$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "量詞の練習" }),
  ).toBeVisible();

  for (let i = 0; i < QUESTION_COUNT; i++) {
    await expect(
      page.getByRole("progressbar", { name: "進捗" }),
    ).toHaveAttribute("aria-valuenow", String(i));
    await pickUntilRight(page, GROUP);
    await page
      .getByRole("button", {
        name: i + 1 < QUESTION_COUNT ? "次へ" : "結果を見る",
      })
      .click();
  }
  await expect(page.getByText("記録に保存しました。")).toBeVisible();

  const { rows } = await db.query(
    'SELECT * FROM "ComplementPracticeRecord" WHERE "userId" = $1',
    [owner],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].mode).toBe("measure");
  expect(rows[0].questionCount).toBe(QUESTION_COUNT);
  expect(rows[0].elapsedMs).toBeGreaterThan(0);
  const questions = rows[0].questions as { id: string; misses: string[] }[];
  for (const question of questions)
    expect(question.id).toMatch(/^measure-\d{2,}$/);
  expect(rows[0].firstTryCount).toBe(
    questions.filter((q) => q.misses.length === 0).length,
  );

  // The round sits in the list the complements share.
  await page.getByRole("link", { name: "過去の記録" }).last().click();
  await expect(page).toHaveURL(/\/practice\/complements\/records$/);
  await page.getByText("量詞 · 25問", { exact: true }).click();
  await expect(page.getByText("すべての問題（25問）")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("量詞 · 25問中");

  // Missed questions come back on the review page as complement items under
  // a 量詞 badge. Picking in order misses whenever the right choice is not
  // the first, so a round of 25 without a miss does not happen.
  const missed = questions.filter((q) => q.misses.length > 0);
  expect(missed.length).toBeGreaterThan(0);
  const { rows: items } = await db.query(
    `SELECT "kind", "targetId" FROM "ReviewItem" WHERE "userId" = $1 ORDER BY "targetId"`,
    [owner],
  );
  expect(items.map((it) => it.targetId)).toEqual(
    missed.map((q) => q.id).sort(),
  );
  for (const it of items) expect(it.kind).toBe("complement");

  await page.goto("/review");
  const shown = Math.min(missed.length, REVIEW_SESSION_SIZE);
  await expect(page.getByText(`1 / ${shown}`)).toBeVisible();
  await expect(
    page.getByRole("main").getByText("量詞", { exact: true }).first(),
  ).toBeVisible();
  await pickUntilRight(page, "選択肢");
  await page
    .getByRole("group", { name: "思い出せた度合い" })
    .getByRole("button", { name: "簡単" })
    .click();
  if (shown > 1) await expect(page.getByText(`2 / ${shown}`)).toBeVisible();
  else await expect(page.getByText("1問 復習しました")).toBeVisible();
  const { rows: logs } = await db.query(
    `SELECT l."rating" FROM "ReviewLog" l WHERE l."userId" = $1`,
    [owner],
  );
  expect(logs).toEqual([{ rating: 4 }]);
});
