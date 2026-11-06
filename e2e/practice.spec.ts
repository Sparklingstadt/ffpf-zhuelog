import type { Page } from "@playwright/test";

import {
  asAdmin,
  asGuest,
  asMember,
  createMember,
  expect,
  memberOwnerId,
  test,
} from "./fixtures";

const QUESTION_COUNT = 25;

// The kinds of practice, each with its own URL, choice group and record
// kind; the pages and records work the same for both.
const KINDS = [
  { slug: "prepositions", kind: "preposition", word: "介詞" },
  { slug: "complements", kind: "complement", word: "補語" },
] as const;

// Answers every question by picking the choices in order until the right
// one, so the misses depend on where the answers land.
async function answerAll(page: Page, word: string) {
  const choices = page.getByRole("group", { name: `${word}を選ぶ` });
  for (let i = 0; i < QUESTION_COUNT; i++) {
    await expect(
      page.getByRole("progressbar", { name: "進捗" }),
    ).toHaveAttribute("aria-valuenow", String(i));
    for (const button of await choices.getByRole("button").all()) {
      await button.click();
      if (await choices.getByRole("button", { name: /（正解）$/ }).count())
        break;
    }
    await page
      .getByRole("button", {
        name: i + 1 < QUESTION_COUNT ? "次へ" : "結果を見る",
      })
      .click();
  }
}

for (const { slug, kind, word } of KINDS)
  test.describe(`${word}の練習`, () => {
    test("a member's round of 25 shows its result, is recorded and can be read again", async ({
      page,
      db,
    }) => {
      const accountId = await createMember(
        db,
        "taro",
        "太郎",
        "member-password-1",
      );
      await asMember(page, "taro", "member-password-1");
      await page.goto(`/practice/${slug}`);

      const stats = page.locator("dl").first();
      await expect(stats).toContainText("正答率—");
      await expect(stats).toContainText("ミス0回");
      await expect(stats).toContainText("経過時間0:0");

      await answerAll(page, word);

      await expect(page.getByText(`${QUESTION_COUNT}問 終了！`)).toBeVisible();
      await expect(page.getByText("記録に保存しました。")).toBeVisible();
      const { rows } = await db.query(
        `SELECT "ownerId", "kind", "questionCount", "firstTryCount", "missCount", "elapsedMs",
                "questions"->0->>'headword' AS headword
         FROM "PracticeRecord"`,
      );
      expect(rows).toHaveLength(1);
      const [record] = rows;
      expect(record.ownerId).toBe(memberOwnerId(accountId));
      expect(record.kind).toBe(kind);
      expect(record.questionCount).toBe(QUESTION_COUNT);
      expect(record.elapsedMs).toBeGreaterThan(0);
      expect(record.headword).toBeTruthy();
      const accuracy = Math.round(
        (record.firstTryCount / QUESTION_COUNT) * 100,
      );
      const result = page.getByRole("main");
      await expect(result).toContainText(`正答率${accuracy}%`);
      await expect(result).toContainText(`ミス${record.missCount}回`);

      await page.getByRole("link", { name: "過去の記録" }).last().click();
      await expect(page).toHaveURL(
        (url) => url.pathname === `/practice/${slug}/records`,
      );
      await page.getByText(`${QUESTION_COUNT}問`, { exact: true }).click();
      await expect(page).toHaveURL((url) =>
        url.pathname.startsWith(`/practice/${slug}/records/`),
      );
      await expect(
        page.getByText(`すべての問題（${QUESTION_COUNT}問）`),
      ).toBeVisible();
      const detail = page.getByRole("main");
      await expect(detail).toContainText(`ミス${record.missCount}回`);
      // The first question's headword, filled into its prompt.
      await expect(detail.getByRole("listitem").first()).toContainText(
        record.headword,
      );
    });

    test("an admin's rounds are their own; a guest practices without a record", async ({
      page,
      context,
      db,
      browser,
    }) => {
      await asAdmin(context);
      await page.goto(`/practice/${slug}/records`);
      await expect(page.getByText("まだ練習の記録がありません")).toBeVisible();

      const guest = await browser.newPage();
      await asGuest(guest, `/practice/${slug}`);
      await guest.goto(`/practice/${slug}`);
      await expect(guest.getByRole("link", { name: "過去の記録" })).toHaveCount(
        0,
      );
      await answerAll(guest, word);
      await expect(
        guest.getByText("ゲストの練習は記録に残りません。"),
      ).toBeVisible();
      expect((await guest.goto(`/practice/${slug}/records`))?.status()).toBe(
        404,
      );
      expect((await guest.goto("/practice/unknown"))?.status()).toBe(404);
      expect((await guest.goto("/practice/unknown/records"))?.status()).toBe(
        404,
      );
      await guest.close();
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM "PracticeRecord"`,
      );
      expect(rows[0].n).toBe(0);
    });
  });
