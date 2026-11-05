import type { Page } from "@playwright/test";

import {
  asGuest,
  asMember,
  createMember,
  expect,
  memberOwnerId,
  test,
} from "./fixtures";

const QUESTION_COUNT = 25;

// Picks the choices in order until the right one, so most rounds miss some.
async function pickUntilRight(page: Page, groupName: string) {
  const choices = page.getByRole("group", { name: groupName });
  for (const button of await choices.getByRole("button").all()) {
    await button.click();
    if (await choices.getByRole("button", { name: /（正解）$/ }).count())
      return;
  }
}

async function practiceOneRound(page: Page) {
  await page.goto("/practice/prepositions");
  for (let i = 0; i < QUESTION_COUNT; i++) {
    await expect(
      page.getByRole("progressbar", { name: "進捗" }),
    ).toHaveAttribute("aria-valuenow", String(i));
    await pickUntilRight(page, "介詞を選ぶ");
    await page
      .getByRole("button", {
        name: i + 1 < QUESTION_COUNT ? "次へ" : "結果を見る",
      })
      .click();
  }
  await expect(page.getByText("記録に保存しました。")).toBeVisible();
}

test("missed practice questions come back on the review page and an answer reschedules them", async ({
  page,
  db,
}) => {
  const accountId = await createMember(db, "taro", "太郎", "member-password-1");
  const owner = memberOwnerId(accountId);
  await asMember(page, "taro", "member-password-1");

  await page.goto("/");
  await expect(page.getByTestId("review-due-count")).toHaveText("0");
  await expect(page.getByTestId("review-streak-days")).toHaveText("0");

  await practiceOneRound(page);
  const {
    rows: [round],
  } = await db.query(
    `SELECT "questions" FROM "PrepositionPracticeRecord" WHERE "ownerId" = $1`,
    [owner],
  );
  const missed = (
    round.questions as { id: string; noun: string; misses: string[] }[]
  ).filter((q) => q.misses.length > 0);
  test.skip(missed.length === 0, "the round happened to have no misses");

  const { rows: items } = await db.query(
    `SELECT "kind", "targetId", "language", "state" FROM "ReviewItem" WHERE "ownerId" = $1 ORDER BY "targetId"`,
    [owner],
  );
  expect(items.map((it) => it.targetId)).toEqual(
    missed.map((q) => `${q.id}:${q.noun}`).sort(),
  );
  for (const it of items) {
    expect(it.kind).toBe("preposition");
    expect(it.language).toBe("zh");
    expect(it.state).toBe(0);
  }

  await page.goto("/");
  await expect(page.getByTestId("review-due-count")).toHaveText(
    String(missed.length),
  );
  await page.getByRole("link", { name: "復習する" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/review");
  await expect(page.getByText(`1 / ${missed.length}`)).toBeVisible();

  await pickUntilRight(page, "選択肢");
  await page
    .getByRole("group", { name: "思い出せた度合い" })
    .getByRole("button", { name: "簡単" })
    .click();
  if (missed.length > 1)
    await expect(page.getByText(`2 / ${missed.length}`)).toBeVisible();
  else await expect(page.getByText("1問 復習しました")).toBeVisible();

  const { rows: logs } = await db.query(
    `SELECT l."rating", l."state", i."reps", i."due" > now() AS "later"
     FROM "ReviewLog" l JOIN "ReviewItem" i ON i."id" = l."itemId" WHERE l."ownerId" = $1`,
    [owner],
  );
  expect(logs).toEqual([{ rating: 4, state: 0, reps: 1, later: true }]);

  await page.goto("/");
  await expect(page.getByTestId("review-due-count")).toHaveText(
    String(missed.length - 1),
  );
  await expect(page.getByTestId("review-streak-days")).toHaveText("1");
});

test("guests have no review queue", async ({ page }) => {
  await asGuest(page);
  await page.goto("/review");
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.getByTestId("review-due-count")).toHaveCount(0);
});
