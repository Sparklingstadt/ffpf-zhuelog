import { asAdmin, asGuest, expect, test } from "./fixtures";

test("bottom menu fits phones and tablets and follows navigation", async ({
  page,
  context,
}, testInfo) => {
  await asAdmin(context);
  await page.goto("/");
  const menu = page.getByRole("navigation", { name: "メインメニュー" });

  for (const width of [320, 390, 768, 1024, 1279]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(menu).toBeVisible();
    await expect(menu.locator("a, button")).toHaveText([
      "学習ノート",
      "介詞練習",
      "クイック質問",
      "会話ノート",
    ]);
    const bounds = await menu.boundingBox();
    expect(bounds!.y + bounds!.height).toBe(900);
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

  await menu.getByRole("link", { name: "クイック質問" }).click();
  await expect(page).toHaveURL(/\/quick-question$/);
  await expect(
    menu.getByRole("link", { name: "クイック質問" }),
  ).toHaveAttribute("aria-current", "page");
  await page.goto("/");
  await expect(menu.getByRole("link", { name: "学習ノート" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await menu.getByRole("link", { name: "介詞練習" }).click();
  await expect(page).toHaveURL(/\/practice\/prepositions$/);
  await expect(menu.getByRole("link", { name: "介詞練習" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await menu.getByRole("link", { name: "会話ノート" }).click();
  await expect(page).toHaveURL(/\/conversations$/);
  await expect(menu.getByRole("link", { name: "会話ノート" })).toHaveAttribute(
    "aria-current",
    "page",
  );
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
});

test("guest menu keeps four tabs without linking to restricted conversations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/signin");
  const menu = page.getByRole("navigation", { name: "メインメニュー" });
  await expect(menu).toHaveCount(0);
  await asGuest(page);
  await expect(menu).toBeVisible();
  await expect(menu.locator("a, button")).toHaveCount(4);
  await expect(menu.getByRole("button", { name: /会話ノート/ })).toBeDisabled();
  await expect(menu.getByRole("link", { name: "会話ノート" })).toHaveCount(0);
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/signin/);
  await expect(menu).toHaveCount(0);
});
