import type { BrowserContext, Page } from "@playwright/test";
import { ffpfIssuerURL } from "./environment";
import { ffpfStubUser } from "./fixtures/ffpf-oidc-stub";
import { asMember, createMember, expect, test, upload } from "./fixtures";

const password = "member-password-1";

// Signs in through the real button: the web sends the browser to the stub's
// /oauth/authorize, which comes straight back with a code; the web's callback
// hands it to the Go API, which exchanges it at the stub and verifies the ID
// token (signature, iss, aud, exp, nonce) before starting a member session.
async function signInWithFfpf(page: Page, callback = "/") {
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(callback)}`);
  await page.getByRole("button", { name: "FFPF IDでログイン" }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === callback.split("?")[0],
  );
  await expect(
    page.getByText(ffpfStubUser.name, { exact: true }).first(),
  ).toBeVisible();
}

async function sessionCookies(context: BrowserContext) {
  const cookies = await context.cookies();
  const value = (name: string) => cookies.find((c) => c.name === name)?.value;
  return { access: value("zl_access"), refresh: value("zl_refresh") };
}

const memberRow = (page: Page, name: string) =>
  page.getByRole("listitem", { name });

test("an FFPF ID user signs in, keeps notes, gets the portal link and signs out", async ({
  page,
  context,
  db,
}) => {
  await page.goto("/signin");
  await expect(
    page.getByRole("button", { name: "FFPF IDでログイン" }),
  ).toBeVisible();
  await expect(
    // A substring of the sign-in page's privacy note.
    page.getByText("FFPF IDではメールアドレスと表示名が利用されます。"),
  ).toBeVisible();

  await signInWithFfpf(page, "/import");
  // The header shows the ID token's display name.
  await expect(
    page.getByRole("banner").getByText(ffpfStubUser.name, { exact: true }),
  ).toBeVisible();
  const { rows } = await db.query(
    'SELECT id, email, "displayName" FROM "FfpfAccount"',
  );
  expect(rows).toEqual([
    {
      id: ffpfStubUser.sub,
      email: ffpfStubUser.email,
      displayName: ffpfStubUser.name,
    },
  ]);

  // A member: notes can be added, and they are owned by ffpf:<sub>.
  await upload(page, "最初の文,添削後の文,ピン音\n雪の文,雪の添削,xuě");
  await expect(page.getByText("1件の学習文を登録しました。")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("雪の添削", { exact: true })).toBeVisible();
  expect(
    (await db.query('SELECT "ownerId" FROM "LearningEntry"')).rows,
  ).toEqual([{ ownerId: `ffpf:${ffpfStubUser.sub}` }]);

  // No password here: the page points to the portal instead of the form.
  await page.goto("/account/password");
  await expect(page.getByText("FFPF IDでログインしています")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "FFPF ID のマイページを開く" }),
  ).toHaveAttribute("href", `${ffpfIssuerURL}/id`);
  await expect(page.getByLabel("新しいパスワード")).toHaveCount(0);

  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(
    page.getByRole("button", { name: "ゲストとして使う" }),
  ).toBeVisible();
  expect(await sessionCookies(context)).toEqual({
    access: undefined,
    refresh: undefined,
  });
  await page.goto("/logs");
  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
});

test("an FFPF ID user and a password member find and follow each other", async ({
  page,
  browser,
  baseURL,
  db,
}) => {
  await createMember(db, "taro", "太郎", password);
  await signInWithFfpf(page, "/follow");

  // The password member is in the FFPF user's directory and can be followed.
  const taroRow = memberRow(page, "太郎");
  await taroRow.getByRole("button", { name: "フォローする" }).click();
  await expect(
    taroRow.getByRole("button", { name: "フォロー解除" }),
  ).toBeVisible();
  await expect(page.getByText("フォロー中 1人・フォロワー 0人")).toBeVisible();

  // And the FFPF user is in the password member's directory.
  const taro = await browser.newContext({ baseURL });
  try {
    const taroPage = await taro.newPage();
    await asMember(taroPage, "taro", password, "/follow");
    const row = memberRow(taroPage, ffpfStubUser.name);
    await expect(row).toContainText("フォローされています");
    await row.getByRole("button", { name: "フォローする" }).click();
    await expect(
      row.getByRole("button", { name: "フォロー解除" }),
    ).toBeVisible();
  } finally {
    await taro.close();
  }
});
