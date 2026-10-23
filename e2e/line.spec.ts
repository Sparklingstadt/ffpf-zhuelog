import { asGuest, asMember, createMember, expect, test } from "./fixtures";

test("member issues a LINE link code", async ({ page, db }) => {
  await createMember(db, "taro", "太郎", "member-password-1");
  await asMember(page, "taro", "member-password-1");

  await page.getByRole("link", { name: "LINE 連携" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/account/line");
  await expect(
    page.getByRole("heading", { name: "LINE 連携", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("OpenAI（ChatGPT）に送られます")).toBeVisible();

  await page.getByRole("button", { name: "連携コードを出す" }).click();
  const output = page.locator("output");
  await expect(output).toContainText("まで有効（10分）");
  await expect(output.locator("span").first()).toHaveText(/^[A-Z2-9]{8}$/);
});

test("guest has no LINE link menu and is sent away from the page", async ({
  page,
}) => {
  await asGuest(page);
  await expect(page.getByRole("link", { name: "LINE 連携" })).toHaveCount(0);

  await page.goto("/account/line");
  await expect(page).toHaveURL((url) => url.pathname === "/");
});
