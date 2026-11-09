import type { Page } from "@playwright/test";
import {
  asGuest,
  asMember,
  createMember,
  expect,
  memberOwnerId,
  openSiteMenu,
  test,
} from "./fixtures";

const GROUP = "了・过・着を選ぶ";
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

async function answerAll(page: Page, total = 25) {
  for (let i = 0; i < total; i++) {
    await expect(
      page.getByRole("progressbar", { name: "進捗" }),
    ).toHaveAttribute("aria-valuenow", String(i));
    await pickUntilRight(page, GROUP);
    await page
      .getByRole("button", { name: i + 1 < total ? "次へ" : "結果を見る" })
      .click();
  }
}

test("了・过・着: 25 questions are saved as mode aspect, listed with the complements and reviewed", async ({
  page,
  db,
}) => {
  test.setTimeout(90_000);
  const id = await createMember(
    db,
    "aspect-learner",
    "了过着学習者",
    "member-password-1",
  );
  const owner = memberOwnerId(id);
  await asMember(page, "aspect-learner", "member-password-1");
  const menu = await openSiteMenu(page);
  await menu.getByRole("menuitem", { name: "了・过・着の練習" }).click();
  await expect(page).toHaveURL(/\/practice\/aspect-particles$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "了・过・着の練習" }),
  ).toBeVisible();

  await answerAll(page);
  await expect(page.getByText("記録に保存しました。")).toBeVisible();
  const { rows } = await db.query(
    'SELECT * FROM "ComplementPracticeRecord" WHERE "ownerId" = $1',
    [owner],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].mode).toBe("aspect");
  expect(rows[0].questionCount).toBe(25);
  const questions = rows[0].questions as {
    id: string;
    noun: string;
    answer: string;
    misses: string[];
  }[];
  for (const question of questions) {
    expect(question.id).toMatch(/^aspect-\d{2}$/);
    expect(question.noun).toBe("了・过・着");
    expect(["了", "过", "着", "なし"]).toContain(question.answer);
  }
  expect(rows[0].firstTryCount).toBe(
    questions.filter((q) => q.misses.length === 0).length,
  );

  await page.getByRole("link", { name: "過去の記録" }).last().click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "補語、量詞、了・过・着の練習記録",
    }),
  ).toBeVisible();
  await page.getByText("了・过・着 · 25問", { exact: true }).click();
  await expect(page.getByText("すべての問題（25問）")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("了・过・着 · 25問中");

  // Missed questions come back on the review page as complement items,
  // their sentence under a 了・过・着 badge.
  const missed = questions.filter((q) => q.misses.length > 0);
  test.skip(missed.length === 0, "the round happened to have no misses");
  const { rows: items } = await db.query(
    `SELECT "kind", "targetId" FROM "ReviewItem" WHERE "ownerId" = $1 ORDER BY "targetId"`,
    [owner],
  );
  expect(items.map((it) => it.targetId)).toEqual(
    missed.map((q) => q.id).sort(),
  );
  for (const it of items) expect(it.kind).toBe("complement");

  await page.goto("/review");
  const shown = Math.min(missed.length, REVIEW_SESSION_SIZE);
  await expect(page.getByText(`1 / ${shown}`)).toBeVisible();
  const card = page.getByRole("main");
  await expect(
    card.getByText("了・过・着", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "選択肢" }).getByRole("button"),
  ).toHaveText(["了", "过", "着", "なし"]);
  await pickUntilRight(page, "選択肢");
  await page
    .getByRole("group", { name: "思い出せた度合い" })
    .getByRole("button", { name: "簡単" })
    .click();
  if (shown > 1) await expect(page.getByText(`2 / ${shown}`)).toBeVisible();
  else await expect(page.getByText("1問 復習しました")).toBeVisible();
  const { rows: logs } = await db.query(
    `SELECT l."rating" FROM "ReviewLog" l WHERE l."ownerId" = $1`,
    [owner],
  );
  expect(logs).toEqual([{ rating: 4 }]);
});

test("a guest practices from the hub with the four choices in a fixed order, unsaved", async ({
  page,
  db,
}) => {
  test.setTimeout(60_000);
  await asGuest(page, "/practice");
  await page.getByRole("link", { name: "了・过・着を練習" }).click();
  await expect(page).toHaveURL(/\/practice\/aspect-particles$/);
  await expect(page.getByRole("link", { name: "過去の記録" })).toHaveCount(0);

  const choices = page.getByRole("group", { name: GROUP });
  await expect(choices.getByRole("button")).toHaveText([
    "了",
    "过",
    "着",
    "なし",
  ]);
  // The prompt is a sentence with its blank; solving it shows the sentence
  // with its pinyin above.
  await expect(page.getByText(/（　）/).first()).toBeVisible();
  await pickUntilRight(page, GROUP);
  const pinyin = page.locator('[lang="zh-Latn-pinyin"]');
  await expect(pinyin).toHaveText(/^\p{Lu}\S*( \S+)*[.?!”]$/u);
  expect(
    await pinyin.evaluate((el) => el.nextElementSibling?.getAttribute("lang")),
  ).toBe("zh-CN");
  await page.getByRole("button", { name: "次へ" }).click();
  await expect(choices.getByRole("button")).toHaveText([
    "了",
    "过",
    "着",
    "なし",
  ]);

  await page.goto("/practice/aspect-particles");
  await answerAll(page);
  await expect(
    page.getByText("ゲストの練習は記録に残りません。"),
  ).toBeVisible();
  expect(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM "ComplementPracticeRecord"',
      )
    ).rows[0].n,
  ).toBe(0);
});

test("the 了・过・着 and measure-word practices can be narrowed to one HSK level", async ({
  page,
}) => {
  await asGuest(page, "/practice");
  for (const path of [
    "/practice/aspect-particles",
    "/practice/measure-words",
  ]) {
    await page.goto(path);
    const levels = page.getByRole("navigation", { name: "HSK の級" });
    await expect(levels.getByRole("link")).toHaveText([
      /すべて\s*\d+問/,
      /HSK 4級まで\s*\d+問/,
      /HSK 5級\s*\d+問/,
      /HSK 6級以上\s*\d+問/,
    ]);
    await levels.getByRole("link", { name: /HSK 5級/ }).click();
    await expect(page).toHaveURL(new RegExp(`${path}\\?hsk=5$`));
    await expect(levels.getByRole("link", { name: /HSK 5級/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Few questions are of level 5, so the round is shorter than 25.
    const count = Number(
      (await levels.getByRole("link", { name: /HSK 5級/ }).innerText()).match(
        /(\d+)問/,
      )![1],
    );
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(25);
    await expect(
      page.getByRole("progressbar", { name: "進捗" }),
    ).toHaveAttribute("aria-valuemax", String(count));

    // Switching the basis comes back to the same page and level.
    const basis = page.getByRole("group", { name: "級の決め方" });
    await basis.getByRole("button", { name: "公式の語彙表" }).click();
    await expect(page).toHaveURL(new RegExp(`${path}\\?hsk=5$`));
    await expect(
      basis.getByRole("button", { name: "公式の語彙表" }),
    ).toHaveAttribute("aria-pressed", "true");
    await basis.getByRole("button", { name: "手作りの表" }).click();
    await expect(
      basis.getByRole("button", { name: "手作りの表" }),
    ).toHaveAttribute("aria-pressed", "true");
  }
});

test("the 了・过・着 practice fits a phone's width", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await asGuest(page, "/practice/aspect-particles");
  await page.goto("/practice/aspect-particles");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const choices = page.getByRole("group", { name: GROUP });
  await expect(choices.getByRole("button")).toHaveCount(4);
  for (const choice of await choices.getByRole("button").all())
    expect(
      await choice.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("aspect-particles-375.png"),
    fullPage: true,
  });
});
