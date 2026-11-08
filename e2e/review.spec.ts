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
// How many due items /review shows at once (SESSION_SIZE in its page).
const REVIEW_SESSION_SIZE = 20;

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
  // A round with many misses shows only the first session's worth.
  const shown = Math.min(missed.length, REVIEW_SESSION_SIZE);
  await expect(page.getByText(`1 / ${shown}`)).toBeVisible();

  await pickUntilRight(page, "選択肢");
  // As in the practice, the example comes with its pinyin above it.
  const pinyin = page.locator('[lang="zh-Latn-pinyin"]');
  await expect(pinyin).toHaveText(/^\p{Lu}\S*( \S+)*[.?!”]$/u);
  expect(
    await pinyin.evaluate((el) => el.nextElementSibling?.getAttribute("lang")),
  ).toBe("zh-CN");
  await page
    .getByRole("group", { name: "思い出せた度合い" })
    .getByRole("button", { name: "簡単" })
    .click();
  if (shown > 1) await expect(page.getByText(`2 / ${shown}`)).toBeVisible();
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

// The verb mode of the complement practice reviews like the prepositions:
// each missed question comes back by its CSV row and verb, shown large.
test("missed verb-mode complement questions come back on the review page like prepositions", async ({
  page,
  db,
}) => {
  test.setTimeout(60_000);
  const accountId = await createMember(db, "taro", "太郎", "member-password-1");
  const owner = memberOwnerId(accountId);
  await asMember(page, "taro", "member-password-1");

  await page.goto("/practice/complements/verb");
  for (let i = 0; i < QUESTION_COUNT; i++) {
    await expect(
      page.getByRole("progressbar", { name: "進捗" }),
    ).toHaveAttribute("aria-valuenow", String(i));
    await pickUntilRight(page, "補語を選ぶ");
    await page
      .getByRole("button", {
        name: i + 1 < QUESTION_COUNT ? "次へ" : "結果を見る",
      })
      .click();
  }
  await expect(page.getByText("記録に保存しました。")).toBeVisible();
  const {
    rows: [round],
  } = await db.query(
    `SELECT "questions" FROM "ComplementPracticeRecord" WHERE "ownerId" = $1`,
    [owner],
  );
  const missed = (
    round.questions as { id: string; noun: string; misses: string[] }[]
  ).filter((q) => q.misses.length > 0);
  test.skip(missed.length === 0, "the round happened to have no misses");

  const { rows: items } = await db.query(
    `SELECT "kind", "targetId" FROM "ReviewItem" WHERE "ownerId" = $1 ORDER BY "targetId"`,
    [owner],
  );
  expect(items.map((it) => it.targetId)).toEqual(
    missed.map((q) => q.id).sort(),
  );
  for (const it of items) expect(it.kind).toBe("complement");
  for (const q of missed) expect(q.id).toMatch(/^verb:C\d{3}:.+$/);

  await page.goto("/review");
  const shown = Math.min(missed.length, REVIEW_SESSION_SIZE);
  await expect(page.getByText(`1 / ${shown}`)).toBeVisible();
  // The card looks like a preposition one: a 補語 badge and the verb large.
  const card = page.getByRole("main");
  await expect(card.getByText("補語", { exact: true })).toBeVisible();
  const verbs = missed.map((q) => q.noun);
  const heading = card.locator("p.text-6xl").first();
  await expect(heading).toBeVisible();
  expect(verbs).toContain(await heading.innerText());

  await pickUntilRight(page, "選択肢");
  await page
    .getByRole("group", { name: "思い出せた度合い" })
    .getByRole("button", { name: "簡単" })
    .click();
  // The next card (or the end) means the answer has been saved.
  if (shown > 1) await expect(page.getByText(`2 / ${shown}`)).toBeVisible();
  else await expect(page.getByText("1問 復習しました")).toBeVisible();
  const { rows: logs } = await db.query(
    `SELECT l."rating" FROM "ReviewLog" l WHERE l."ownerId" = $1`,
    [owner],
  );
  expect(logs).toEqual([{ rating: 4 }]);
});

test("guests have no review queue", async ({ page }) => {
  await asGuest(page);
  await page.goto("/review");
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.getByTestId("review-due-count")).toHaveCount(0);
});
