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

// One OpenAI call as the Go API records it. createdAt is UTC, as the column
// stores it.
async function recordUsage(
  db: Client,
  row: {
    id: string;
    ownerId: string;
    feature: string;
    inputTokens: number;
    outputTokens: number;
    createdAt: string;
  },
) {
  await db.query(
    `INSERT INTO "AiUsage" ("id", "ownerId", "feature", "model", "inputTokens", "outputTokens", "createdAt")
     VALUES ($1, $2, $3, 'gpt-e2e', $4, $5, $6)`,
    [
      row.id,
      row.ownerId,
      row.feature,
      row.inputTokens,
      row.outputTokens,
      row.createdAt,
    ],
  );
}

test("an admin reads each month's AI usage by person and feature, in Japan time", async ({
  page,
  context,
  db,
}) => {
  const member = memberOwnerId(
    await createMember(db, "taro", "太郎", "member-password-1"),
  );
  const march = "2026-03-10 03:00:00";
  for (const row of [
    { id: "u1", ownerId: member, feature: "chat", in: 1000, out: 40 },
    { id: "u2", ownerId: member, feature: "chat", in: 200, out: 60 },
    { id: "u3", ownerId: member, feature: "quick_question", in: 50, out: 10 },
    {
      id: "u4",
      ownerId: adminOwnerId,
      feature: "vocabulary_draft",
      in: 30,
      out: 5,
    },
  ])
    await recordUsage(db, {
      id: row.id,
      ownerId: row.ownerId,
      feature: row.feature,
      inputTokens: row.in,
      outputTokens: row.out,
      createdAt: march,
    });
  // 15:30 UTC on March 31 is 00:30 on April 1 in Japan.
  await recordUsage(db, {
    id: "u5",
    ownerId: member,
    feature: "line",
    inputTokens: 7,
    outputTokens: 3,
    createdAt: "2026-03-31 15:30:00",
  });

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
  // Nothing was used this month.
  await expect(
    page.getByText("この月は、まだ使われていません。"),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);

  await page.goto("/admin/ai-usage?month=2026-03");
  await expect(page.getByText("2026年3月", { exact: true })).toBeVisible();
  await expect(page.getByText("2人が 4 回使いました。")).toBeVisible();
  const cells = (name: string | RegExp) =>
    page.getByRole("row", { name }).getByRole("cell");
  // The person with the most tokens comes first, then their features.
  await expect(page.getByRole("row")).toHaveText([
    /人・機能/,
    /太郎/,
    /ChatGPT と話す/,
    /クイック質問/,
    /管理者/,
    /単語帳の下書き/,
    /合計/,
  ]);
  await expect(cells(/太郎/)).toHaveText([
    new RegExp(`^太郎\\s*${member}$`),
    "3",
    "1,250",
    "110",
  ]);
  await expect(cells(/ChatGPT と話す/)).toHaveText([
    /^ChatGPT と話す\s*gpt-e2e$/,
    "2",
    "1,200",
    "100",
  ]);
  await expect(cells(/クイック質問/)).toHaveText([/gpt-e2e$/, "1", "50", "10"]);
  // An admin has no account row, so no name of their own.
  await expect(cells(/管理者/)).toHaveText([
    new RegExp(`^管理者\\s*${adminOwnerId}$`),
    "1",
    "30",
    "5",
  ]);
  await expect(cells(/合計/)).toHaveText(["合計", "4", "1,280", "115"]);

  const months = page.getByRole("navigation", { name: "月の切り替え" });
  await months.getByRole("link", { name: "次の月" }).click();
  await expect(page).toHaveURL(/\/admin\/ai-usage\?month=2026-04$/);
  await expect(page.getByText("2026年4月", { exact: true })).toBeVisible();
  await expect(page.getByText("1人が 1 回使いました。")).toBeVisible();
  await expect(cells(/LINE の添削・翻訳/)).toHaveText([
    /gpt-e2e$/,
    "1",
    "7",
    "3",
  ]);

  await months.getByRole("link", { name: "前の月" }).click();
  await expect(page).toHaveURL(/month=2026-03$/);
  await months.getByRole("link", { name: "前の月" }).click();
  await expect(page).toHaveURL(/month=2026-02$/);
  await expect(page.getByText("2026年2月", { exact: true })).toBeVisible();
  await expect(
    page.getByText("この月は、まだ使われていません。"),
  ).toBeVisible();

  // A month that is not one falls back to this month rather than failing.
  await page.goto("/admin/ai-usage?month=2026-13");
  await expect(
    page.getByText("この月は、まだ使われていません。"),
  ).toBeVisible();
  await expect(page.getByText("利用量を読めませんでした")).toHaveCount(0);
});

test("members and guests have no AI usage page", async ({
  page,
  browser,
  db,
}) => {
  await createMember(db, "taro", "太郎", "member-password-1");
  await asMember(page, "taro", "member-password-1");
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
  } finally {
    await guestContext.close();
  }
});
