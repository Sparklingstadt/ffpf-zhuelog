import { randomUUID } from "node:crypto";
import type { Client } from "pg";

import {
  adminOwnerId,
  asAdmin,
  asGuest,
  asMember,
  createMember,
  expect,
  memberOwnerId,
  openSiteMenu,
  test,
} from "./fixtures";

// Inserts one OpenAI call. Times are UTC (the fixture sets the session time
// zone); 15:00 UTC is the start of the next Japan day.
async function recordUsage(
  db: Client,
  ownerId: string,
  feature: string,
  model: string,
  tokens: [input: number, output: number],
  createdAt: string,
) {
  await db.query(
    `INSERT INTO "AiUsage" (id, "ownerId", feature, model, "inputTokens", "outputTokens", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), ownerId, feature, model, ...tokens, createdAt],
  );
}

test("the admin reads a Japan month of AI usage, most tokens first", async ({
  page,
  context,
  db,
}) => {
  const hanako = memberOwnerId(
    await createMember(db, "hanako", "花子", "member-password-1"),
  );
  await recordUsage(
    db,
    hanako,
    "line",
    "gpt-5-mini",
    [100, 50],
    "2026-10-31 15:00:00",
  );
  await recordUsage(
    db,
    hanako,
    "line",
    "gpt-5-mini",
    [200, 60],
    "2026-11-30 14:59:59.999",
  );
  await recordUsage(
    db,
    hanako,
    "chat",
    "gpt-5",
    [10, 5],
    "2026-10-31 15:00:00",
  );
  // The last moment of October in Japan.
  await recordUsage(
    db,
    hanako,
    "line",
    "gpt-5-mini",
    [9999, 9999],
    "2026-10-31 14:59:59.999",
  );
  await recordUsage(
    db,
    adminOwnerId,
    "chat",
    "gpt-5",
    [5000, 1000],
    "2026-11-15 00:00:00",
  );

  await asAdmin(context);
  await page.goto("/admin/ai-usage?month=2026-11");
  await expect(page.getByText("2026年11月")).toBeVisible();
  await expect(page.getByText("2人が 4 回使いました。")).toBeVisible();

  // The admin used the most tokens, so comes first.
  const people = page.locator("tbody");
  await expect(
    people.nth(0).getByRole("row").first().getByRole("cell"),
  ).toHaveText([/^管理者\s*10001$/, "1", "5,000", "1,000"]);
  const hanakoRows = people.nth(1).getByRole("row");
  await expect(hanakoRows.nth(0).getByRole("cell")).toHaveText([
    /^花子/,
    "3",
    "310",
    "115",
  ]);
  await expect(hanakoRows.nth(1).getByRole("cell")).toHaveText([
    /^ChatGPT と話す\s*gpt-5$/,
    "1",
    "10",
    "5",
  ]);
  await expect(hanakoRows.nth(2).getByRole("cell")).toHaveText([
    /^LINE の添削・翻訳\s*gpt-5-mini$/,
    "2",
    "300",
    "110",
  ]);
  await expect(page.locator("tfoot").getByRole("cell")).toHaveText([
    "合計",
    "4",
    "5,310",
    "1,115",
  ]);

  await page.getByRole("link", { name: "← 前の月" }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("month") === "2026-10",
  );
  await expect(page.getByText("1人が 1 回使いました。")).toBeVisible();
  await expect(page.getByText("9,999").first()).toBeVisible();
});

// The menu opens this month; the links step one month either way. The usage
// is in a past year, so it is never in the month the test runs in.
test("the admin opens this month from the menu and steps through the months", async ({
  page,
  context,
  db,
}) => {
  // 15:00 UTC on October 31 is the first moment of November in Japan.
  await recordUsage(
    db,
    adminOwnerId,
    "quick_question",
    "gpt-5-mini",
    [7, 3],
    "2025-10-31 15:00:00",
  );
  const empty = page.getByText("この月は、まだ使われていません。");
  const months = page.getByRole("navigation", { name: "月の切り替え" });

  await asAdmin(context);
  await page.goto("/");
  await (
    await openSiteMenu(page)
  )
    .getByRole("menuitem", { name: "AI 利用量" })
    .click();
  await expect(page).toHaveURL((url) => url.pathname === "/admin/ai-usage");
  await expect(
    page.getByRole("heading", { level: 1, name: "AI の利用量" }),
  ).toBeVisible();
  // Nothing was used this month, so there is no table to show.
  await expect(empty).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);

  await page.goto("/admin/ai-usage?month=2025-10");
  await expect(months.getByText("2025年10月", { exact: true })).toBeVisible();
  await expect(empty).toBeVisible();
  await months.getByRole("link", { name: "次の月" }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("month") === "2025-11",
  );
  await expect(months.getByText("2025年11月", { exact: true })).toBeVisible();
  await expect(page.getByText("1人が 1 回使いました。")).toBeVisible();
  await expect(
    page.locator("tbody").getByRole("row").nth(1).getByRole("cell"),
  ).toHaveText([/^クイック質問\s*gpt-5-mini$/, "1", "7", "3"]);
  // The links cross into the next year and back.
  await months.getByRole("link", { name: "次の月" }).click();
  await expect(months.getByText("2025年12月", { exact: true })).toBeVisible();
  await months.getByRole("link", { name: "次の月" }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("month") === "2026-01",
  );
  await expect(months.getByText("2026年1月", { exact: true })).toBeVisible();
  await expect(empty).toBeVisible();
  await months.getByRole("link", { name: "前の月" }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("month") === "2025-12",
  );

  // A month that is not one is this month, not an error.
  await page.goto("/admin/ai-usage?month=2026-13");
  await expect(months).toBeVisible();
  await expect(months).not.toContainText("13月");
  await expect(empty).toBeVisible();
  await expect(page.getByText("利用量を読めませんでした")).toHaveCount(0);
});

test("members and guests are sent home from the AI usage, and their menu does not offer it", async ({
  page,
  browser,
  db,
}) => {
  await createMember(db, "hanako", "花子", "member-password-1");
  await asMember(page, "hanako", "member-password-1");
  await expect(
    (await openSiteMenu(page)).getByRole("menuitem", { name: "AI 利用量" }),
  ).toHaveCount(0);
  await page.goto("/admin/ai-usage");
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.getByRole("heading", { name: "AI の利用量" })).toHaveCount(
    0,
  );

  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await asGuest(guest);
    await guest.goto("/admin/ai-usage");
    await expect(guest).toHaveURL((url) => url.pathname === "/");
    await expect(
      guest.getByRole("heading", { name: "AI の利用量" }),
    ).toHaveCount(0);
  } finally {
    await guestContext.close();
  }
});
