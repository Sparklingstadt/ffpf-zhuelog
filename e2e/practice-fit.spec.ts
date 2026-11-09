import type { Locator, Page } from "@playwright/test";

import { asAdmin, expect, test } from "./fixtures";

// The top of the bottom tabs and the bottom of the sticky header: what lies
// between them is what a phone shows.
async function visibleBand(page: Page) {
  const tabs = await page
    .getByRole("navigation", { name: "メインメニュー" })
    .boundingBox();
  const header = await page.getByRole("banner").boundingBox();
  return { top: header!.y + header!.height, bottom: tabs!.y };
}

async function expectInView(page: Page, locator: Locator) {
  await expect
    .poll(async () => {
      const band = await visibleBand(page);
      const box = await locator.boundingBox();
      return (
        box !== null && box.y >= band.top && box.y + box.height <= band.bottom
      );
    })
    .toBe(true);
}

for (const { path, choiceLabel } of [
  { path: "/practice/prepositions", choiceLabel: "介詞を選ぶ" },
  { path: "/practice/measure-words", choiceLabel: "量詞を選ぶ" },
  {
    path: "/practice/complements/direction-compound",
    choiceLabel: "補語を選ぶ",
  },
  { path: "/practice/complements/verb", choiceLabel: "補語を選ぶ" },
  { path: "/practice/aspect-particles", choiceLabel: "了・过・着を選ぶ" },
]) {
  test(`${path} fits a phone: the question and all four choices above the tabs`, async ({
    page,
    context,
  }, testInfo) => {
    await asAdmin(context);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(path);

    const progress = page.getByRole("progressbar", { name: "進捗" });
    const choices = page.getByRole("group", { name: choiceLabel });
    await expect(choices.getByRole("button")).toHaveCount(4);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expectInView(page, progress);
    await expectInView(page, choices);
    // Each stat keeps its label beside its value, on one row.
    expect(
      (await page.locator("main dl").first().boundingBox())!.height,
    ).toBeLessThan(44);
    // The basis of the HSK levels waits below the practice.
    const basis = page.getByRole("group", { name: "級の決め方" });
    expect((await basis.boundingBox())!.y).toBeGreaterThan(
      (await choices.boundingBox())!.y,
    );
    await page.screenshot({
      path: testInfo.outputPath(`${path.replaceAll("/", "-")}-question.png`),
    });

    // A right answer scrolls just far enough to show "next" above the tabs.
    for (const button of await choices.getByRole("button").all()) {
      await button.click();
      if (await choices.getByRole("button", { name: /（正解）$/ }).count())
        break;
    }
    const next = page.getByRole("button", { name: "次へ" });
    await expect(next).toBeFocused();
    await expectInView(page, next);
    await page.screenshot({
      path: testInfo.outputPath(`${path.replaceAll("/", "-")}-solved.png`),
    });

    // "Next" brings the next question and its choices back into view.
    await next.click();
    await expect(next).toHaveCount(0);
    await expectInView(page, progress);
    await expectInView(page, choices);
  });
}

// A wide but short window (a laptop with the browser not maximised) gets the
// compact practice too, and the round scrolls into view when the page header
// would push its choices out of sight.
test("a wide but short window shows the question and the choices", async ({
  page,
  context,
}) => {
  await asAdmin(context);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const size of [
    { width: 1024, height: 600 },
    { width: 1366, height: 640 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/practice/prepositions");
    const choices = page.getByRole("group", { name: "介詞を選ぶ" });
    await expect(choices.getByRole("button")).toHaveCount(4);
    // Measured in the page, so a failure shows the positions.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const header = document
            .querySelector("header.sticky")!
            .getBoundingClientRect();
          const tabs = document.querySelector(
            'nav[aria-label="メインメニュー"]',
          );
          const limit =
            tabs && tabs.getClientRects().length > 0
              ? tabs.getBoundingClientRect().top
              : window.innerHeight;
          const progress = document
            .querySelector('[role="progressbar"]')!
            .getBoundingClientRect();
          const group = document
            .querySelector('[role="group"][aria-label="介詞を選ぶ"]')!
            .getBoundingClientRect();
          return {
            inView: progress.top >= header.bottom - 1 && group.bottom <= limit,
            progressTop: progress.top,
            headerBottom: header.bottom,
            choicesBottom: group.bottom,
            limit,
          };
        }),
      )
      .toMatchObject({ inView: true });
    // The large sizes are kept for wide and tall screens only.
    expect(
      await choices
        .getByRole("button")
        .first()
        .evaluate((button) => button.getBoundingClientRect().height),
    ).toBeLessThan(64);
  }
});
