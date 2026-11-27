import { type BrowserContext, type Page } from "@playwright/test";
import type { Client } from "pg";
import { sessionCookieName } from "./environment";
import {
  anyWidth,
  asGuest,
  asMember,
  createDemoMember,
  createMember,
  expect,
  signInWithPassword,
  signOut,
  test,
} from "./fixtures";

const password = "member-password-1";
// The sign-in page's one message for a refused password sign-in: wrong
// credentials and too many attempts are not told apart.
const credentialsMessage =
  "IDまたはパスワードが違うか、一時的にロックされています。";

async function cookie(context: BrowserContext, name: string) {
  return (await context.cookies()).find((entry) => entry.name === name);
}

async function sessionUsers(db: Client) {
  const { rows } = await db.query(`SELECT "userId" FROM "session"`);
  return rows.map((row) => row.userId as string);
}

// The cookie's expiry, in seconds from now, is the Max-Age the web set.
function expectLifetime(expires: number | undefined, seconds: number) {
  const left = (expires ?? 0) - Date.now() / 1000;
  expect(Math.abs(left - seconds)).toBeLessThanOrEqual(120);
}

async function expectSignedOut(page: Page) {
  await page.goto("/logs");
  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
}

// Submits the password form once and waits for Better Auth's answer.
async function submitPassword(page: Page, loginId: string, secret: string) {
  await page.getByLabel("ログインID").fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(secret);
  const answered = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/sign-in/username"),
  );
  await page.getByRole("button", { name: "IDとパスワードでログイン" }).click();
  return answered;
}

test("members whose ids have '-' or 32 characters sign in, and signing out ends the session", async ({
  page,
  context,
  db,
  baseURL,
}) => {
  const longId = "a".repeat(32);
  const dashedId = await createMember(db, "a-b.c", "太郎", password);
  const longUserId = await createMember(db, longId, "次郎", password);

  await asMember(page, "a-b.c", password, "/logs");
  const session = await cookie(context, sessionCookieName);
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expectLifetime(session?.expires, 2_592_000);
  expect(await sessionUsers(db)).toEqual([dashedId]);
  await expect(page.getByRole("banner").getByText("太郎")).toBeVisible();

  await signOut(page);
  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
  await expect(
    page.getByRole("button", { name: "ゲストとして使う" }),
  ).toBeVisible();
  expect(await sessionUsers(db)).toEqual([]);
  expect(await cookie(context, sessionCookieName)).toBeUndefined();

  // The old cookie names a deleted session.
  await context.addCookies([
    {
      name: sessionCookieName,
      value: session!.value,
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await expectSignedOut(page);

  // The browser still holds the stale cookie: the sign-in must not let it
  // clear the new one. Typed with capitals and spaces, the 32-character id
  // still signs in.
  await asMember(page, ` ${longId.toUpperCase()} `, password, "/logs");
  await expect(page.getByRole("banner").getByText("次郎")).toBeVisible();
  expect(await sessionUsers(db)).toEqual([longUserId]);
});

test(
  "a wrong password shows the sign-in page's own message",
  anyWidth,
  async ({ page, db }) => {
    await createMember(db, "taro", "太郎", password);
    await page.goto("/signin?callbackUrl=%2Flogs");
    const response = await submitPassword(page, "taro", "wrong-password-1");
    expect(response.status()).toBe(401);
    await expect(page.getByText(credentialsMessage)).toBeVisible();
    await expect(page.getByText(/invalid/i)).toHaveCount(0);
    await expect(page).toHaveURL(/\/signin(?:\?|$)/);

    // An unknown login id gets the same message.
    await submitPassword(page, "nobody", password);
    await expect(page.getByText(credentialsMessage)).toBeVisible();
    expect(await sessionUsers(db)).toEqual([]);
  },
);

test(
  "the 21st attempt in 15 minutes is refused with the same message",
  anyWidth,
  async ({ page, db }) => {
    await createMember(db, "taro", "太郎", password);
    await page.goto("/signin?callbackUrl=%2Flogs");
    for (let i = 0; i < 20; i++) {
      const response = await submitPassword(page, "taro", "wrong-password-1");
      expect(response.status()).toBe(401);
      await expect(page.getByText(credentialsMessage)).toBeVisible();
    }
    // The right password, but over the limit.
    const response = await submitPassword(page, "taro", password);
    expect(response.status()).toBe(429);
    await expect(page.getByText(credentialsMessage)).toBeVisible();
    await expect(page.getByText(/too many/i)).toHaveCount(0);
    await expect(page).toHaveURL(/\/signin(?:\?|$)/);
    expect(await sessionUsers(db)).toEqual([]);
  },
);

test("a guest sees the practice only", async ({ page, db }) => {
  await asGuest(page);
  await expect(
    page.getByText("ゲストは学習ノートを利用できません。", { exact: false }),
  ).toBeVisible();
  const { rows } = await db.query(
    `SELECT "isAnonymous" FROM "user" u JOIN "session" s ON s."userId" = u."id"`,
  );
  expect(rows).toEqual([{ isAnonymous: true }]);

  // Pages with nothing for a guest send it home; the practice opens.
  await page.goto("/import");
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await page.goto("/practice");
  await expect(page).toHaveURL((url) => url.pathname === "/practice");

  await signOut(page);
  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
  expect(await sessionUsers(db)).toEqual([]);
});

test("the demo button signs in to the demo account", async ({ page, db }) => {
  const demoId = await createDemoMember(db);
  await page.goto("/signin");
  await page.getByRole("button", { name: "デモで試す" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(
    page.getByRole("status", { name: "デモアカウント" }),
  ).toBeVisible();
  expect(await sessionUsers(db)).toEqual([demoId]);

  await page.getByRole("button", { name: "デモを終える" }).click();
  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
  expect(await sessionUsers(db)).toEqual([]);
});

test(
  "a signed-in visitor to the sign-in page goes home",
  anyWidth,
  async ({ page, db }) => {
    await createMember(db, "taro", "太郎", password);
    await signInWithPassword(page, "taro", password, "/logs");
    await expect(page).toHaveURL((url) => url.pathname === "/logs");
    await page.goto("/signin");
    await expect(page).toHaveURL((url) => url.pathname === "/");
  },
);

test("an expired session is signed out", anyWidth, async ({ page, db }) => {
  await createMember(db, "taro", "太郎", password);
  await asMember(page, "taro", password, "/logs");
  await db.query(
    `UPDATE "session" SET "expiresAt" = NOW() - interval '1 second'`,
  );
  await expectSignedOut(page);
});

test(
  "the retired cookies alone are signed out",
  anyWidth,
  async ({ page, context, baseURL }) => {
    await context.addCookies(
      [
        ["zl_session", "A".repeat(43)],
        ["zl_act_as", "x"],
        ["zl_access", "x"],
        ["zl_refresh", "y"],
      ].map(([name, value]) => ({
        name,
        value,
        url: baseURL!,
        httpOnly: true,
        sameSite: "Lax" as const,
      })),
    );
    await expectSignedOut(page);
  },
);
