import { type BrowserContext } from "@playwright/test";
import { asMember, createMember, expect, test } from "./fixtures";

async function sessionCookies(context: BrowserContext) {
  const cookies = await context.cookies();
  const value = (name: string) => cookies.find((c) => c.name === name)?.value;
  return { access: value("zl_access"), refresh: value("zl_refresh") };
}

test("the proxy refreshes a missing access token, and sign-out revokes the old refresh token", async ({
  context,
  page,
  db,
  baseURL,
}) => {
  await createMember(db, "taro", "太郎", "member-password-1");
  await asMember(page, "taro", "member-password-1", "/logs");
  const before = await sessionCookies(context);
  expect(before.access).toBeTruthy();
  expect(before.refresh).toBeTruthy();

  // Only the refresh token is left, as after the access cookie expires.
  await context.clearCookies({ name: "zl_access" });
  await page.goto("/logs");
  await expect(page).toHaveURL((url) => url.pathname === "/logs");
  await expect(
    page.getByRole("heading", { name: "日付別の学習ノート" }),
  ).toBeVisible();
  await expect(page.getByText("太郎")).toBeVisible();

  // Both cookies were re-issued and the refresh token was rotated. The access
  // token may equal the old one: a JWT for the same user in the same second
  // is byte-identical, so only its presence is checked.
  const after = await sessionCookies(context);
  expect(after.access).toBeTruthy();
  expect(after.refresh).toBeTruthy();
  expect(after.refresh).not.toBe(before.refresh);

  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(
    page.getByRole("button", { name: "ゲストとして使う" }),
  ).toBeVisible();
  expect(await sessionCookies(context)).toEqual({
    access: undefined,
    refresh: undefined,
  });

  // Replaying the rotated-away refresh token: sign-out revoked its family,
  // so Go answers 401 and the proxy clears the cookies and sends to /signin.
  await context.addCookies([
    {
      name: "zl_refresh",
      value: before.refresh!,
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/logs");
  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
  expect(await sessionCookies(context)).toEqual({
    access: undefined,
    refresh: undefined,
  });
});
