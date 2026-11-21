import type { BrowserContext, Page } from "@playwright/test";
import { sidIssuerURL } from "./environment";
import { sidStubUser } from "./fixtures/sid-oidc-stub";
import {
  asMember,
  createMember,
  expect,
  test,
  upload,
  signOut,
} from "./fixtures";

const password = "member-password-1";

// Signs in through the real button: the web sends the browser to the stub's
// /oauth/authorize, which comes straight back with a code; the web exchanges it
// at the stub and verifies the ID token itself (signature, iss, aud, exp,
// nonce) before starting a member session.
async function signInWithSid(page: Page, callback = "/") {
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(callback)}`);
  await page
    .getByRole("button", { name: "Sparklingstadt ID でログイン" })
    .click();
  await expect(page).toHaveURL(
    (url) => url.pathname === callback.split("?")[0],
  );
  await expect(
    page.getByText(sidStubUser.name, { exact: true }).first(),
  ).toBeVisible();
}

async function sessionCookies(context: BrowserContext) {
  const cookies = await context.cookies();
  return { session: cookies.find((c) => c.name === "zl_session")?.value };
}

const memberRow = (page: Page, name: string) =>
  page.getByRole("listitem", { name });

test("a Sparklingstadt ID user signs in, keeps notes, gets the portal link and signs out", async ({
  page,
  context,
  db,
}) => {
  await page.goto("/signin");
  await expect(
    page.getByRole("button", { name: "Sparklingstadt ID でログイン" }),
  ).toBeVisible();
  await expect(
    // A substring of the sign-in page's privacy note.
    page.getByText(
      "Sparklingstadt ID ではメールアドレスと表示名が利用されます。",
    ),
  ).toBeVisible();

  await signInWithSid(page, "/import");
  // The header shows the ID token's display name.
  await expect(
    page.getByRole("banner").getByText(sidStubUser.name, { exact: true }),
  ).toBeVisible();
  const { rows } = await db.query(
    'SELECT id, email, "displayName" FROM "SidAccount"',
  );
  expect(rows).toEqual([
    {
      id: sidStubUser.sub,
      email: sidStubUser.email,
      displayName: sidStubUser.name,
    },
  ]);

  // A member: notes can be added, and they are owned by sid:<sub>.
  await upload(page, "最初の文,添削後の文,ピン音\n雪の文,雪の添削,xuě");
  await expect(page.getByText("1件の学習文を登録しました。")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("雪の添削", { exact: true })).toBeVisible();
  expect(
    (await db.query('SELECT "ownerId" FROM "LearningEntry"')).rows,
  ).toEqual([{ ownerId: `sid:${sidStubUser.sub}` }]);
  expect(
    (await db.query('SELECT "ownerId", role, "sessionVersion" FROM "Session"'))
      .rows,
  ).toEqual([
    { ownerId: `sid:${sidStubUser.sub}`, role: "member", sessionVersion: 0 },
  ]);

  // No password here: the page points to the portal instead of the form.
  await page.goto("/account/password");
  await expect(
    page.getByText("Sparklingstadt ID でログインしています"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Sparklingstadt ID のアカウントページを開く",
    }),
  ).toHaveAttribute("href", `${sidIssuerURL}/account`);
  await expect(page.getByLabel("新しいパスワード")).toHaveCount(0);

  await signOut(page);
  await expect(
    page.getByRole("button", { name: "ゲストとして使う" }),
  ).toBeVisible();
  expect(await sessionCookies(context)).toEqual({ session: undefined });
  expect((await db.query('SELECT 1 FROM "Session"')).rows).toEqual([]);
  await page.goto("/logs");
  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
});

test("a Sparklingstadt ID user and a password member find and follow each other", async ({
  page,
  browser,
  baseURL,
  db,
}) => {
  await createMember(db, "taro", "太郎", password);
  await signInWithSid(page, "/follow");

  // The password member is in the Sparklingstadt ID user's directory and can be followed.
  const taroRow = memberRow(page, "太郎");
  await taroRow.getByRole("button", { name: "フォローする" }).click();
  await expect(
    taroRow.getByRole("button", { name: "フォロー解除" }),
  ).toBeVisible();
  await expect(page.getByText("フォロー中 1人・フォロワー 0人")).toBeVisible();

  // And the Sparklingstadt ID user is in the password member's directory.
  const taro = await browser.newContext({ baseURL });
  try {
    const taroPage = await taro.newPage();
    await asMember(taroPage, "taro", password, "/follow");
    const row = memberRow(taroPage, sidStubUser.name);
    await expect(row).toContainText("フォローされています");
    await row.getByRole("button", { name: "フォローする" }).click();
    await expect(
      row.getByRole("button", { name: "フォロー解除" }),
    ).toBeVisible();
  } finally {
    await taro.close();
  }
});
