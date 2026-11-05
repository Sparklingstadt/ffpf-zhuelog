import { asGuest, asMember, createMember, expect, test } from "./fixtures";

// Today in Japan, as the page counts it.
function todayInJapan() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test("what a member does today shows on the study log calendar", async ({
  page,
  db,
}) => {
  await createMember(db, "taro", "太郎", "member-password-1");
  await asMember(page, "taro", "member-password-1");

  await page.goto("/vocabulary");
  await page.getByLabel("語句").fill("认真");
  await page.getByLabel("意味").fill("まじめに");
  await page.getByRole("button", { name: "単語帳に入れる" }).click();
  await expect(page.getByText("「认真」を単語帳に入れました。")).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "学習ログ" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/study-log");

  const today = todayInJapan();
  const [year, month] = today.split("-").map(Number);
  await expect(
    page.getByRole("heading", { name: `${year}年${month}月` }),
  ).toBeVisible();
  const totals = page.getByLabel("この月の合計");
  await expect(totals).toContainText("学習した日1日");
  await expect(totals).toContainText("単語1語");
  await expect(page.locator(`[data-date="${today}"]`).first()).toHaveAttribute(
    "data-total",
    "1",
  );
  await expect(
    page.getByRole("gridcell", { name: `${today}：単語1語` }),
  ).toBeVisible();

  // The month before has nothing yet, and offers the way back.
  await page.getByRole("link", { name: "前の月" }).click();
  await expect(totals).toContainText("学習した日0日");
  await page.getByRole("link", { name: "次の月" }).click();
  await expect(totals).toContainText("単語1語");
  await expect(page.getByRole("link", { name: "次の月" })).toHaveCount(0);
});

test("guests have no study log", async ({ page }) => {
  await asGuest(page);
  await page.goto("/study-log");
  await expect(page).toHaveURL((url) => url.pathname === "/");
});
