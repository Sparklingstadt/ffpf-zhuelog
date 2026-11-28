import type { Page } from "@playwright/test";

import { asAdmin, expect, test } from "./fixtures";

// Holds back the page's own answer for `path` (not the prefetch that brings
// its loading skeleton) until the returned function is called.
async function holdPage(page: Page, path: string) {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const url = new RegExp(`:\\d+${path}(\\?.*)?$`);
  await page.route(url, async (route) => {
    const headers = route.request().headers();
    const prefetch =
      "next-router-prefetch" in headers ||
      "next-router-segment-prefetch" in headers;
    if (!prefetch) await held;
    await route.continue();
  });
  return async () => {
    release();
    // Waits for the held answer to go through before the route is removed.
    await page.unrouteAll({ behavior: "wait" });
  };
}

// Every page is rendered on demand, so the main pages show their skeleton
// the moment their link is pressed, before the server answers.
test("the main pages show a skeleton while they load", async ({
  page,
  context,
}) => {
  await asAdmin(context);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const links = page.getByRole("navigation", { name: "主なページ" });

  for (const [link, path, label, heading] of [
    ["今日の復習", "/review", "復習を読み込んでいます", "今日の復習"],
    ["練習", "/practice", "練習の一覧を読み込んでいます", "文法の練習"],
    ["単語帳", "/vocabulary", "単語帳を読み込んでいます", "単語帳"],
    ["学習ノート", "/", "学習ノートを読み込んでいます", "学習ノート"],
  ] as const) {
    // The links' prefetches bring the skeletons.
    await page.waitForLoadState("networkidle");
    const release = await holdPage(page, path);
    await links.getByRole("link", { name: link }).click();
    const status = page.getByRole("status").filter({ hasText: label });
    await expect(status).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "true");
    await expect(page).toHaveURL((url) => url.pathname === path);
    await release();
    await expect(
      page.getByRole("heading", { level: 1, name: heading, exact: true }),
    ).toBeVisible();
    await expect(status).toHaveCount(0);
  }
});

// A skeleton wraps only its own page: the pages below /practice and the
// other top-level pages keep answering as before.
test("the skeletons do not reach other pages", async ({ page, context }) => {
  await asAdmin(context);
  expect((await page.goto("/practice/complements/invalid"))?.status()).toBe(
    404,
  );
  expect((await page.goto("/logs/2026/9/24/9007199254740991"))?.status()).toBe(
    404,
  );
});
