import {
  asAdmin,
  asGuest,
  expect,
  openSiteMenu,
  signOut,
  test,
} from "./fixtures";

test("bottom menu fits phones and tablets and follows navigation", async ({
  page,
  context,
}, testInfo) => {
  await asAdmin(context);
  await page.goto("/");
  const menu = page.getByRole("navigation", { name: "メインメニュー" });
  await expect(
    page.getByRole("banner").getByRole("link", { name: "学习録", exact: true }),
  ).toHaveAttribute("href", "/");

  for (const width of [320, 390, 768, 1024, 1279]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(menu).toBeVisible();
    await expect(menu.locator("a, button")).toHaveText([
      "学習ノート",
      "復習",
      "LINE 連携",
      "クイック質問",
      "会話ノート",
    ]);
    // The header stays one row: the main links move to the bottom tabs.
    await expect(
      page.getByRole("navigation", { name: "主なページ" }),
    ).toBeHidden();
    const header = await page.getByRole("banner").boundingBox();
    expect(header!.height).toBeLessThanOrEqual(50);
    const bounds = await menu.boundingBox();
    expect(bounds!.y + bounds!.height).toBe(900);
    const middleTab = await menu
      .getByRole("link", { name: "LINE 連携" })
      .boundingBox();
    expect(middleTab!.x + middleTab!.width / 2).toBeCloseTo(width / 2, 0);
    expect(
      await menu.evaluate((element) => {
        const body = document.body;
        return (
          document.documentElement.scrollWidth <= window.innerWidth &&
          parseFloat(getComputedStyle(body).paddingBottom) >=
            element.getBoundingClientRect().height &&
          Array.from(element.querySelectorAll("a, button")).every(
            (tab) => tab.scrollWidth <= tab.clientWidth,
          )
        );
      }),
    ).toBe(true);
    if (width === 390 || width === 1024) {
      await page.screenshot({
        path: testInfo.outputPath(`bottom-menu-${width}.png`),
      });
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, url] of [
    ["会話ノート", /\/conversations$/],
    ["クイック質問", /\/quick-question$/],
    ["LINE 連携", /\/account\/line$/],
    ["復習", /\/review$/],
  ] as const) {
    await menu.getByRole("link", { name }).click();
    await expect(page).toHaveURL(url);
    await expect(menu.getByRole("link", { name })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }

  // Practice and the vocabulary have no tab: the header's menu has them.
  const siteMenu = await openSiteMenu(page);
  await siteMenu.getByRole("menuitem", { name: "練習の一覧" }).click();
  await expect(page).toHaveURL(/\/practice$/);
  await expect(siteMenu).toBeHidden();
  await expect(menu.locator("[aria-current=page]")).toHaveCount(0);
  await (
    await openSiteMenu(page)
  )
    .getByRole("menuitem", { name: "単語帳" })
    .click();
  await expect(page).toHaveURL(/\/vocabulary$/);

  await page.goto("/logs/trash");
  await expect(menu.getByRole("link", { name: "学習ノート" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(menu).toBeHidden();
  expect(
    await page
      .locator("body")
      .evaluate((body) => getComputedStyle(body).paddingBottom),
  ).toBe("0px");
  const mainLinks = page.getByRole("navigation", { name: "主なページ" });
  await expect(mainLinks.getByRole("link")).toHaveText([
    "学習ノート",
    "今日の復習",
    "練習",
    "単語帳",
    "AI に聞く",
  ]);
  await expect(
    mainLinks.getByRole("link", { name: "学習ノート" }),
  ).toHaveAttribute("aria-current", "page");
});

test("guest menu keeps five tabs without linking to restricted features", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/signin");
  const menu = page.getByRole("navigation", { name: "メインメニュー" });
  await expect(menu).toHaveCount(0);
  await asGuest(page);
  await expect(menu).toBeVisible();
  await expect(menu.locator("a, button")).toHaveCount(5);
  await expect(menu.getByRole("link")).toHaveCount(1);
  await expect(menu.getByRole("link", { name: "学習ノート" })).toHaveAttribute(
    "href",
    "/",
  );
  for (const name of [/復習/, /LINE 連携/, /クイック質問/, /会話ノート/])
    await expect(menu.getByRole("button", { name })).toBeDisabled();

  const siteMenu = await openSiteMenu(page);
  await expect(siteMenu.getByRole("menuitem")).toHaveText([
    "練習の一覧",
    "介詞の練習",
    "補語の練習",
    "量詞の練習",
    "了・过・着の練習",
    "GitHub のリポジトリ（新しいタブ）",
    "ログアウト",
  ]);
  // The color theme is in the menu once signed in.
  await expect(
    siteMenu
      .getByRole("group", { name: "カラーテーマ" })
      .getByRole("menuitemradio"),
  ).toHaveText(["システム", "ライト", "ダーク"]);
  await page.keyboard.press("Escape");
  await expect(siteMenu).toBeHidden();

  await signOut(page);
  await expect(page).toHaveURL(/\/signin/);
  await expect(menu).toHaveCount(0);
});
