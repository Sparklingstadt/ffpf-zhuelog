import type { Page } from "@playwright/test";
import {
  asGuest,
  asMember,
  createMember,
  expect,
  memberOwnerId,
  test,
} from "./fixtures";

async function answerAll(page: Page) {
  const choices = page.getByRole("group", { name: "補語を選ぶ" });
  for (let i = 0; i < 25; i++) {
    await expect(
      page.getByRole("progressbar", { name: "進捗" }),
    ).toHaveAttribute("aria-valuenow", String(i));
    for (const button of await choices.getByRole("button").all()) {
      await button.click();
      if (await choices.getByRole("button", { name: /（正解）$/ }).count())
        break;
    }
    await page
      .getByRole("button", { name: i < 24 ? "次へ" : "結果を見る" })
      .click();
  }
}

for (const [mode, label] of [
  ["result", "結果補語"],
  ["potential", "可能補語"],
  ["degree", "程度補語"],
  ["direction-simple", "単純方向補語"],
  ["direction-compound", "複合方向補語"],
  ["direction-simple-extended", "単純方向補語の派生義"],
  ["direction-compound-extended", "複合方向補語の派生義"],
  ["verb", "動詞から選ぶ"],
]) {
  test(`${label}: 25 questions save their mode and can be reviewed`, async ({
    page,
    db,
  }) => {
    test.setTimeout(60_000);
    const id = await createMember(
      db,
      "complement-learner",
      "補語学習者",
      "member-password-1",
    );
    await asMember(page, "complement-learner", "member-password-1");
    // The header's link; on phones the bottom menu has one too.
    await page
      .getByRole("navigation", { name: "アカウント" })
      .getByRole("link", { name: "補語練習", exact: true })
      .click();
    await page
      .getByRole("link", { name: `${label}を練習`, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/practice/complements/${mode}$`));
    await answerAll(page);
    await expect(page.getByText("記録に保存しました。")).toBeVisible();
    const { rows } = await db.query('SELECT * FROM "ComplementPracticeRecord"');
    expect(rows).toHaveLength(1);
    expect(rows[0].mode).toBe(mode);
    expect(rows[0].ownerId).toBe(memberOwnerId(id));
    expect(rows[0].questionCount).toBe(25);
    expect(rows[0].elapsedMs).toBeGreaterThan(0);
    // The verb mode names its questions by CSV row and verb, the others by
    // mode and number.
    for (const question of rows[0].questions)
      expect(question.id).toMatch(
        mode === "verb" ? /^verb:C\d{3}:.+$/ : new RegExp(`^${mode}-\\d+$`),
      );
    expect(rows[0].firstTryCount).toBe(
      rows[0].questions.filter(
        (q: { misses: string[] }) => q.misses.length === 0,
      ).length,
    );
    await page.getByRole("link", { name: "過去の記録" }).last().click();
    await page.getByText(`${label} · 25問`, { exact: true }).click();
    await expect(page.getByText("すべての問題（25問）")).toBeVisible();
    await expect(page.getByRole("main")).toContainText(`${label} · 25問中`);
  });
}

test("guest can retry without saving; records are forbidden and invalid modes are 404", async ({
  page,
  db,
}) => {
  test.setTimeout(60_000);
  await asGuest(page, "/practice/complements");
  await page.goto("/practice/complements/degree");
  await expect(page.getByRole("link", { name: "過去の記録" })).toHaveCount(0);
  await answerAll(page);
  await expect(
    page.getByText("ゲストの練習は記録に残りません。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "もう一度" }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  expect((await page.goto("/practice/complements/records"))?.status()).toBe(
    404,
  );
  expect((await page.goto("/practice/complements/invalid"))?.status()).toBe(
    404,
  );
  expect(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM "ComplementPracticeRecord"',
      )
    ).rows[0].n,
  ).toBe(0);
});

test("mode selection and all quiz modes fit the viewport", async ({
  page,
}, testInfo) => {
  await asGuest(page, "/practice/complements");
  for (const mode of [
    "",
    "/result",
    "/potential",
    "/degree",
    "/direction-simple",
    "/direction-compound",
    "/direction-simple-extended",
    "/direction-compound-extended",
    "/verb",
  ]) {
    await page.goto(`/practice/complements${mode}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (mode) {
      const choices = page.getByRole("group", { name: "補語を選ぶ" });
      await expect(choices.getByRole("button")).toHaveCount(4);
      for (const choice of await choices.getByRole("button").all()) {
        expect(
          await choice.evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
      }
    }
    await page.screenshot({
      path: testInfo.outputPath(`complements${mode.replace("/", "-")}.png`),
      fullPage: true,
    });
  }
});

test("a solved question shows the example's pinyin above it", async ({
  page,
}) => {
  await asGuest(page);
  for (const mode of ["result", "verb"]) {
    await page.goto(`/practice/complements/${mode}`);
    const choices = page.getByRole("group", { name: "補語を選ぶ" });
    for (const button of await choices.getByRole("button").all()) {
      await button.click();
      if (await choices.getByRole("button", { name: /（正解）$/ }).count())
        break;
    }
    const pinyin = page.locator('[lang="zh-Latn-pinyin"]');
    await expect(pinyin).toHaveText(/^\p{Lu}\S*( \S+)*[.?!”]$/u);
    expect(
      await pinyin.evaluate((el) =>
        el.nextElementSibling?.getAttribute("lang"),
      ),
    ).toBe("zh-CN");
  }
});
