import { asAdmin, asGuest, expect, signOut, test } from "./fixtures";

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
      "練習",
      "単語帳",
      "メニュー",
    ]);
    // The header stays one row: the main links move to the bottom tabs.
    await expect(
      page.getByRole("navigation", { name: "主なページ" }),
    ).toBeHidden();
    const header = await page.getByRole("banner").boundingBox();
    expect(header!.height).toBeLessThanOrEqual(50);
    const bounds = await menu.boundingBox();
    expect(bounds!.y + bounds!.height).toBe(900);
    const practiceTab = await menu
      .getByRole("link", { name: "練習" })
      .boundingBox();
    expect(practiceTab!.x + practiceTab!.width / 2).toBeCloseTo(width / 2, 0);
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
  await menu.getByRole("link", { name: "練習" }).click();
  await expect(page).toHaveURL(/\/practice$/);
  await expect(menu.getByRole("link", { name: "練習" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("link", { name: "量詞を練習" }).click();
  await expect(page).toHaveURL(/\/practice\/measure-words$/);
  await expect(menu.getByRole("link", { name: "練習" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await menu.getByRole("link", { name: "復習" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(menu.getByRole("link", { name: "復習" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // The last tab opens the menu with everything else, above the tabs.
  await menu.getByRole("button", { name: "メニュー" }).click();
  const siteMenu = page.getByRole("menu", { name: "メニュー" });
  await expect(siteMenu).toBeVisible();
  const menuBox = await siteMenu.boundingBox();
  const tabsBox = await menu.boundingBox();
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(tabsBox!.y);
  await siteMenu.getByRole("menuitem", { name: "クイック質問" }).click();
  await expect(page).toHaveURL(/\/quick-question$/);
  await expect(siteMenu).toBeHidden();
  await expect(menu.locator("[aria-current=page]")).toHaveCount(0);

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
  await expect(menu.getByRole("link", { name: "練習" })).toHaveAttribute(
    "href",
    "/practice",
  );
  await expect(menu.getByRole("button", { name: /復習/ })).toBeDisabled();
  await expect(menu.getByRole("button", { name: /単語帳/ })).toBeDisabled();
  await expect(menu.getByRole("link", { name: "復習" })).toHaveCount(0);

  await menu.getByRole("button", { name: "メニュー" }).click();
  const siteMenu = page.getByRole("menu", { name: "メニュー" });
  await expect(siteMenu.getByRole("menuitem")).toHaveText([
    "介詞の練習",
    "補語の練習",
    "量詞の練習",
    "ログアウト",
  ]);
  await page.keyboard.press("Escape");
  await expect(siteMenu).toBeHidden();

  await signOut(page);
  await expect(page).toHaveURL(/\/signin/);
  await expect(menu).toHaveCount(0);
});
