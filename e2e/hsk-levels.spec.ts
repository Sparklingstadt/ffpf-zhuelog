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

test("the HSK levels can be decided by the official word list, and the choice is kept", async ({
  page,
}) => {
  await asGuest(page, "/practice/complements/result?hsk=6");
  const levels = page.getByRole("navigation", { name: "HSK の級" });
  const basis = page.getByRole("group", { name: "級の決め方" });
  const sixCount = async () =>
    Number(
      (
        await levels.getByRole("link", { name: /HSK 6級以上/ }).innerText()
      ).match(/(\d+)問/)![1],
    );

  await expect(
    basis.getByRole("button", { name: "手作りの表" }),
  ).toHaveAttribute("aria-pressed", "true");
  const curated = await sixCount();

  await basis.getByRole("button", { name: "公式の語彙表" }).click();
  await expect(
    basis.getByRole("button", { name: "公式の語彙表" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/practice\/complements\/result\?hsk=6$/);
  const official = await sixCount();
  expect(official).not.toBe(curated);

  // The choice carries over to the other practices.
  await page.goto("/practice/prepositions");
  await expect(
    page
      .getByRole("group", { name: "級の決め方" })
      .getByRole("button", { name: "公式の語彙表" }),
  ).toHaveAttribute("aria-pressed", "true");
});
