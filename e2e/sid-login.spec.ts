import type { BrowserContext, Page } from "@playwright/test";
import { sessionCookieName, sidIssuerURL } from "./environment";
import { sidStubUser } from "./fixtures/sid-oidc-stub";
import {
  anyWidth,
  asMember,
  createMember,
  expect,
  test,
  upload,
  signOut,
} from "./fixtures";

const password = "member-password-1";

// Signs in through the real button: Better Auth sends the browser to the
// stub's /oauth/authorize (found by discovery), which comes straight back with
// a code; Better Auth exchanges it at the stub and verifies the ID token
// (signature against the JWKS, iss, aud, exp, nonce) before starting a
// session.
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
  return { session: cookies.find((c) => c.name === sessionCookieName)?.value };
}

// The stub's record of /oauth/logout calls (it runs in the e2e server process).
async function logoutCalls(method: "GET" | "DELETE" = "GET") {
  const response = await fetch(`${sidIssuerURL}/__logouts`, { method });
  return (await response.json()) as {
    clientId: string;
    postLogoutRedirectUri: string;
  }[];
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
  // The first sign-in makes a member: a "user" from the ID token and a "sid"
  // account keyed by the sub.
  const { rows } = await db.query(
    `SELECT u."id", u."email", u."name", u."role", u."username", a."accountId"
       FROM "user" u JOIN "account" a ON a."userId" = u."id" AND a."providerId" = 'sid'`,
  );
  expect(rows).toEqual([
    {
      id: expect.any(String),
      email: sidStubUser.email,
      name: sidStubUser.name,
      role: "user",
      username: null,
      accountId: sidStubUser.sub,
    },
  ]);
  const userId = rows[0].id as string;

  // A member: notes can be added, and they are owned by the new user.
  await upload(page, "最初の文,添削後の文,ピン音\n雪の文,雪の添削,xuě");
  await expect(page.getByText("1件の学習文を登録しました。")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("雪の添削", { exact: true })).toBeVisible();
  expect((await db.query('SELECT "userId" FROM "LearningEntry"')).rows).toEqual(
    [{ userId }],
  );
  expect((await db.query('SELECT "userId" FROM "session"')).rows).toEqual([
    { userId },
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
  expect((await db.query('SELECT 1 FROM "session"')).rows).toEqual([]);
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

test("signing out of Sparklingstadt ID goes through the ID server's logout once and back to /signin", async ({
  page,
  context,
  baseURL,
  db,
}) => {
  await logoutCalls("DELETE");
  await signInWithSid(page, "/");
  // A second sign-in keeps the one "sid" account (found by its sub).
  await signOut(page);
  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
  await logoutCalls("DELETE");
  await signInWithSid(page, "/");
  expect(
    (await db.query(`SELECT 1 FROM "account" WHERE "providerId" = 'sid'`)).rows,
  ).toHaveLength(1);
  await signOut(page);

  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
  await expect(
    page.getByRole("button", { name: "ゲストとして使う" }),
  ).toBeVisible();
  expect(await logoutCalls()).toEqual([
    {
      clientId: "e2e-sid-client",
      postLogoutRedirectUri: `${baseURL}/signin`,
    },
  ]);
  expect(await sessionCookies(context)).toEqual({ session: undefined });
  expect((await db.query('SELECT 1 FROM "session"')).rows).toEqual([]);
});

test("a password member's sign-out does not pass through the ID server", async ({
  page,
  db,
}) => {
  await createMember(db, "hanako", "花子", password);
  await logoutCalls("DELETE");
  await asMember(page, "hanako", password, "/");
  await signOut(page);

  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
  await expect(
    page.getByRole("button", { name: "ゲストとして使う" }),
  ).toBeVisible();
  expect(await logoutCalls()).toEqual([]);
});

// Better Auth's own (English) error page is never shown: every failure comes
// back to the sign-in page with a Japanese message.
async function expectJapaneseFailure(page: Page, message: string) {
  await expect(page).toHaveURL(/\/signin\?/);
  await expect(page.getByText(message)).toBeVisible();
  // Neither Better Auth's error code nor its English wording.
  await expect(page.locator("body")).not.toContainText(
    /error|state|please|denied|invalid/i,
  );
  await expect(
    page.getByRole("button", { name: "Sparklingstadt ID でログイン" }),
  ).toBeVisible();
}

test(
  "a callback with an unknown state comes back to the sign-in page in Japanese",
  anyWidth,
  async ({ page, db }) => {
    await page.goto("/api/auth/callback/sid?code=stub&state=bogus-state");
    await expectJapaneseFailure(
      page,
      "認証中にエラーが発生しました。もう一度お試しください。",
    );
    expect((await db.query('SELECT 1 FROM "session"')).rows).toEqual([]);
  },
);

test(
  "a sign-in declined on the ID server shows the callback message and keeps the page to come back to",
  anyWidth,
  async ({ page, db }) => {
    await fetch(`${sidIssuerURL}/__deny-next`, { method: "POST" });
    await page.goto(`/signin?callbackUrl=${encodeURIComponent("/import")}`);
    await page
      .getByRole("button", { name: "Sparklingstadt ID でログイン" })
      .click();
    await expectJapaneseFailure(
      page,
      "認証サービスからの結果を確認できませんでした。もう一度お試しください。",
    );
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/import");
    expect((await db.query('SELECT 1 FROM "session"')).rows).toEqual([]);
  },
);
