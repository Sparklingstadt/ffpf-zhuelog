import { randomUUID } from "node:crypto";
import type { Client } from "pg";

import {
  adminOwnerId,
  asAdmin,
  asMember,
  createMember,
  expect,
  memberOwnerId,
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

test("members are sent home from the AI usage", async ({ page, db }) => {
  await createMember(db, "hanako", "花子", "member-password-1");
  await asMember(page, "hanako", "member-password-1");
  await page.goto("/admin/ai-usage");
  await expect(page).toHaveURL((url) => url.pathname === "/");
});
