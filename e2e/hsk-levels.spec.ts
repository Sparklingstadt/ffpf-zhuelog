import { asGuest, expect, test } from "./fixtures";

test("preposition and complement practices can be narrowed to one HSK level", async ({
  page,
}) => {
  await asGuest(page, "/practice/prepositions");
  const levels = page.getByRole("navigation", { name: "HSK の級" });
  await expect(levels.getByRole("link")).toHaveText([
    /すべて\s*\d+問/,
    /HSK 4級まで\s*\d+問/,
    /HSK 5級\s*\d+問/,
    /HSK 6級以上\s*\d+問/,
  ]);
  await expect(levels.getByRole("link", { name: /すべて/ })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await levels.getByRole("link", { name: /HSK 5級/ }).click();
  await expect(page).toHaveURL(/\/practice\/prepositions\?hsk=5$/);
  await expect(levels.getByRole("link", { name: /HSK 5級/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("progressbar", { name: "進捗" })).toHaveAttribute(
    "aria-valuemax",
    "25",
  );

  // A level with fewer different complements than 25 gives a shorter round.
  await page.goto("/practice/complements/verb?hsk=6");
  await expect(
    levels.getByRole("link", { name: /HSK 6級以上/ }),
  ).toHaveAttribute("aria-current", "page");
  const total = Number(
    await page
      .getByRole("progressbar", { name: "進捗" })
      .getAttribute("aria-valuemax"),
  );
  expect(total).toBeGreaterThan(0);
  expect(total).toBeLessThanOrEqual(25);

  // An unknown level shows every question.
  await page.goto("/practice/complements/result?hsk=9");
  await expect(levels.getByRole("link", { name: /すべて/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
