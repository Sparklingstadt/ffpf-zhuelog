import { asAdmin, expect, test, upload } from "./fixtures";

test("long imported text stays inside cards at narrow widths", async ({
  page,
  context,
}) => {
  await asAdmin(context);
  await page.goto("/");
  const longWord = "pīnyīn".repeat(50);
  const hint = "長いヒントの説明です。".repeat(20) + longWord;
  await upload(
    page,
    ["原文" + longWord, "添削文" + longWord, longWord, hint].join(","),
  );
  await expect(page.getByText("1件の学習文を登録しました。")).toBeVisible();
  const dateHref = await page
    .getByRole("link", { name: "この日の一覧" })
    .getAttribute("href");
  expect(dateHref).toBeTruthy();
  for (const path of ["/", dateHref!, `${dateHref}/1`]) {
    await page.goto(path);
    const card = page.locator("details");
    await expect(card).toHaveCount(1);
    for (const width of [320, 375, 430, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(card.getByText(hint, { exact: true })).toBeVisible();
      const overflow = await card.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          page: document.documentElement.scrollWidth > window.innerWidth + 1,
          card: bounds.right > window.innerWidth + 1 || bounds.left < 0,
          content: Array.from(
            element.querySelectorAll("p, [data-slot=badge]"),
          ).some((child) => {
            const rect = child.getBoundingClientRect();
            return (
              child.scrollWidth > child.clientWidth + 1 ||
              child.scrollHeight > child.clientHeight + 1 ||
              rect.right > bounds.right + 1 ||
              rect.left < bounds.left
            );
          }),
        };
      });
      expect(overflow, `${path} at ${width}px`).toEqual({
        page: false,
        card: false,
        content: false,
      });
    }
    await card.locator("summary").click();
    await expect(card.getByText(hint, { exact: true })).toBeHidden();
    await card.locator("summary").click();
    await expect(card.getByText(hint, { exact: true })).toBeVisible();
  }
});
