import { type Page } from "@playwright/test";
import type { Client } from "pg";

import {
  anyWidth,
  asAdmin,
  asMember,
  createMember,
  expect,
  signInWithPassword,
  test,
} from "./fixtures";

const lockMessage = "IDまたはパスワードが違うか、一時的にロックされています。";
const currentPasswordMessage =
  "現在のパスワードが違うか、一時的にロックされています。";
const passwordLengthMessage = "パスワードは12〜128文字にしてください。";

// The role badge in the top bar is hidden below `sm` to leave room for the
// links.
async function expectRoleBadge(page: Page, role: string) {
  const badge = page.getByText(role, { exact: true });
  if ((page.viewportSize()?.width ?? 0) < 640) await expect(badge).toBeHidden();
  else await expect(badge).toBeVisible();
}

async function readOutputPassword(page: Page) {
  const output = page.locator("output");
  await expect(output).toContainText("この画面を離れると再表示できません");
  const text = (await output.innerText()).replace(/\s+/g, " ");
  const match = text.match(/パスワード: (\S+?)（/);
  if (!match) throw new Error(`Password not found in: ${text}`);
  return match[1];
}

async function memberSessions(db: Client, userId: string) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`,
    [userId],
  );
  return rows[0].n as number;
}

// The member's user and the hash in their credential account.
async function account(db: Client, loginId: string) {
  const { rows } = await db.query(
    `SELECT u."id", u."name" AS "displayName", u."email", u."role",
            a."password" AS "passwordHash"
       FROM "user" u JOIN "account" a ON a."userId" = u."id" AND a."providerId" = 'credential'
      WHERE u."username" = $1`,
    [loginId],
  );
  return rows[0] as
    | {
        id: string;
        displayName: string;
        email: string;
        role: string;
        passwordHash: string;
      }
    | undefined;
}

// Better Auth's rate-limit counters for the password change.
async function passwordChangeAttempts(db: Client) {
  const { rows } = await db.query(
    `SELECT "count" FROM "rateLimit" WHERE "key" LIKE '%/change-password'`,
  );
  return rows.map((row) => row.count as number);
}

// Next.js's route announcer is an alert too, so match the one with the text.
async function expectAlert(page: Page, text: string) {
  await expect(page.getByRole("alert").filter({ hasText: text })).toBeVisible();
}

async function fillCreateForm(
  page: Page,
  loginId: string,
  displayName: string,
  password = "",
) {
  await page.getByLabel("ログインID", { exact: true }).fill(loginId);
  await page.getByLabel("表示名").fill(displayName);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByRole("button", { name: "アカウントを作成" }).click();
}

async function fillChangeForm(
  page: Page,
  current: string,
  next: string,
  confirm = next,
) {
  await page.getByLabel("現在のパスワード").fill(current);
  await page.getByLabel("新しいパスワード", { exact: true }).fill(next);
  await page.getByLabel("新しいパスワード（確認）").fill(confirm);
  await page.getByRole("button", { name: "パスワードを変更" }).click();
}

test("admin creates a member who can open their notes", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  await asAdmin(context);
  await page.goto("/");
  // The role badge is hidden below `sm` to leave room for the links.
  const badge = page.getByText("管理者", { exact: true });
  if ((page.viewportSize()?.width ?? 0) < 640) await expect(badge).toBeHidden();
  else await expect(badge).toBeVisible();
  await page.goto("/admin/accounts");
  await page.getByLabel("ログインID", { exact: true }).fill("taro");
  await page.getByLabel("表示名").fill("太郎");
  await page.getByRole("button", { name: "アカウントを作成" }).click();
  const password = await readOutputPassword(page);
  expect(password.length).toBeGreaterThanOrEqual(12);
  await expect(page.getByText("ログインID: taro")).toBeVisible();

  const memberContext = await browser.newContext({ baseURL });
  try {
    const memberPage = await memberContext.newPage();
    await asMember(memberPage, "taro", password, "/logs");
    await expect(
      memberPage.getByRole("heading", { name: "日付別の学習ノート" }),
    ).toBeVisible();
    await expect(memberPage.getByText("太郎")).toBeVisible();
    await expectRoleBadge(memberPage, "メンバー");
  } finally {
    await memberContext.close();
  }
});

test(
  "member cannot open account management",
  anyWidth,
  async ({ page, db }) => {
    await createMember(db, "taro", "太郎", "member-password-1");
    await asMember(page, "taro", "member-password-1");
    await page.goto("/admin/accounts");
    await expect(page).toHaveURL((url) => url.pathname === "/");
    await expect(
      page.getByRole("heading", { name: "アカウント管理" }),
    ).toHaveCount(0);
  },
);

test(
  "wrong password shows one generic error",
  anyWidth,
  async ({ page, db }) => {
    await createMember(db, "taro", "太郎", "member-password-1");

    // The form stays on the sign-in page with the message.
    await signInWithPassword(page, "taro", "wrong-password-1");
    await expect(page.getByText(lockMessage)).toBeVisible();
    await expect(page).toHaveURL((url) => url.pathname === "/signin");

    // An unknown ID gets exactly the same message.
    await signInWithPassword(page, "nobody", "wrong-password-1");
    await expect(page.getByText(lockMessage)).toBeVisible();
    await expect(page).toHaveURL((url) => url.pathname === "/signin");
  },
);

test(
  "members sign in by login id only: their mail address does not sign in",
  anyWidth,
  async ({ page, context, db }) => {
    await createMember(db, "taro", "太郎", "member-password-1");
    await page.goto("/signin");
    const status = await page.evaluate(async () => {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "taro@members.zhuelog.invalid",
          password: "member-password-1",
        }),
      });
      return response.status;
    });
    expect(status).toBe(404);
    expect(
      (await db.query(`SELECT count(*)::int AS n FROM "session"`)).rows[0].n,
    ).toBe(0);
    expect(
      (await context.cookies()).some((cookie) =>
        cookie.name.endsWith("better-auth.session_token"),
      ),
    ).toBe(false);
  },
);

test(
  "too many sign-ins pause that client only",
  anyWidth,
  async ({ browser, baseURL, db }) => {
    await createMember(db, "taro", "太郎", "member-password-1");
    // Better Auth reads the client address from x-real-ip, which Vercel sets,
    // and allows 20 sign-ins per 15 minutes from one address.
    const attacker = await browser.newContext({
      baseURL,
      extraHTTPHeaders: { "x-real-ip": "203.0.113.7" },
    });
    const owner = await browser.newContext({
      baseURL,
      extraHTTPHeaders: { "x-real-ip": "198.51.100.9" },
    });
    try {
      const attackerPage = await attacker.newPage();
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await signInWithPassword(
          attackerPage,
          "taro",
          `wrong-password-${attempt}`,
        );
        await expect(attackerPage.getByText(lockMessage)).toBeVisible();
      }

      // Even the correct password is refused from that client for now.
      await signInWithPassword(attackerPage, "taro", "member-password-1");
      await expect(attackerPage.getByText(lockMessage)).toBeVisible();
      await expect(attackerPage).toHaveURL(/\/signin/);

      // The failures elsewhere never lock the member out of their own client.
      await asMember(await owner.newPage(), "taro", "member-password-1");
    } finally {
      await attacker.close();
      await owner.close();
    }
  },
);

test(
  "reset revokes existing member sessions",
  anyWidth,
  async ({ page, context, browser, baseURL, db }) => {
    const accountId = await createMember(
      db,
      "taro",
      "太郎",
      "member-password-1",
    );
    // The member is signed in from two browsers.
    const memberContext = await browser.newContext({ baseURL });
    const secondContext = await browser.newContext({ baseURL });
    try {
      const memberPage = await memberContext.newPage();
      const secondPage = await secondContext.newPage();
      await asMember(memberPage, "taro", "member-password-1", "/logs");
      await expect(
        memberPage.getByRole("heading", { name: "日付別の学習ノート" }),
      ).toBeVisible();
      await asMember(secondPage, "taro", "member-password-1", "/logs");
      expect(await memberSessions(db, accountId)).toBe(2);

      await asAdmin(context);
      await page.goto("/admin/accounts");
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "パスワードを再設定" }).click();
      const newPassword = await readOutputPassword(page);
      expect(newPassword).not.toBe("member-password-1");
      expect(await memberSessions(db, accountId)).toBe(0);

      for (const signedOut of [memberPage, secondPage]) {
        await signedOut.goto("/logs");
        await expect(signedOut).toHaveURL(/\/signin/);
      }

      // The old password no longer works; the reissued one does.
      await signInWithPassword(memberPage, "taro", "member-password-1");
      await expect(memberPage.getByText(lockMessage)).toBeVisible();
      await asMember(memberPage, "taro", newPassword, "/logs");
    } finally {
      await memberContext.close();
      await secondContext.close();
    }
  },
);

test("member changes own password, and their other browsers are signed out", async ({
  page,
  browser,
  baseURL,
  db,
}) => {
  const accountId = await createMember(db, "taro", "太郎", "member-password-1");
  const hashBefore = (await account(db, "taro"))?.passwordHash;
  const otherContext = await browser.newContext({ baseURL });
  try {
    const other = await otherContext.newPage();
    await asMember(other, "taro", "member-password-1", "/logs");
    await asMember(page, "taro", "member-password-1");
    expect(await memberSessions(db, accountId)).toBe(2);

    await page.goto("/account/password");
    await fillChangeForm(page, "member-password-1", "member-password-2");

    await expect(page).toHaveURL(/\/signin\?notice=password-changed/);
    await expect(
      page.getByText(
        "パスワードを変更しました。新しいパスワードでログインしてください。",
      ),
    ).toBeVisible();
    const after = await account(db, "taro");
    expect(after?.passwordHash).not.toBe(hashBefore);
    expect(after?.passwordHash).toMatch(/^scrypt:32768:8:1:/);
    expect(await memberSessions(db, accountId)).toBe(0);

    // The other browser is back at the sign-in page on its next request.
    await other.goto("/logs");
    await expect(other).toHaveURL(/\/signin/);
  } finally {
    await otherContext.close();
  }

  await signInWithPassword(page, "taro", "member-password-1");
  await expect(page.getByText(lockMessage)).toBeVisible();
  await asMember(page, "taro", "member-password-2");
});

test(
  "the admin's form errors are the same",
  anyWidth,
  async ({ page, context, db }) => {
    await createMember(db, "taro", "太郎", "member-password-1");
    await asAdmin(context);
    await page.goto("/admin/accounts");

    await fillCreateForm(page, "ab", "x");
    await expectAlert(
      page,
      "ログインIDは英小文字・数字・. _ - の3〜32文字にしてください。",
    );
    // The input's `required` lets whitespace through; the server refuses it.
    await fillCreateForm(page, "hanako", "   ");
    await expectAlert(page, "表示名は1〜50文字にしてください。");
    await fillCreateForm(page, "hanako", "花子", "short");
    await expectAlert(page, passwordLengthMessage);
    await fillCreateForm(page, "TARO", "太郎2");
    await expectAlert(page, "このログインIDはすでに使われています。");
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM "user" WHERE "role" = 'user'`,
    );
    expect(rows[0].n).toBe(1);

    const hashBefore = (await account(db, "taro"))?.passwordHash;
    await page.getByLabel("taro の新しいパスワード").fill("short");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "パスワードを再設定" }).click();
    await expectAlert(page, passwordLengthMessage);
    expect((await account(db, "taro"))?.passwordHash).toBe(hashBefore);
  },
);

test("a created member signs in with the password the web hashed", async ({
  page,
  context,
  browser,
  baseURL,
  db,
}) => {
  // Spaces around the password are kept; the loginId and name are trimmed.
  const password = "  keep spaces 1 ";
  await asAdmin(context);
  await page.goto("/admin/accounts");
  await fillCreateForm(page, " Hanako", "  花子  ", password);
  const output = page.locator("output");
  await expect(output).toContainText("この画面を離れると再表示できません");
  await expect(page.getByText("ログインID: hanako")).toBeVisible();
  // innerText collapses spaces, so read the password's own text node.
  expect(await output.locator("span").nth(1).textContent()).toBe(password);

  const created = await account(db, "hanako");
  expect(created?.displayName).toBe("花子");
  expect(created?.email).toBe("hanako@members.zhuelog.invalid");
  expect(created?.role).toBe("user");
  expect(created?.passwordHash).toMatch(
    /^scrypt:32768:8:1:[\w-]{22}:[\w-]{86}$/,
  );

  const memberContext = await browser.newContext({ baseURL });
  try {
    const memberPage = await memberContext.newPage();
    await asMember(memberPage, "hanako", password, "/logs");
    await expect(
      memberPage.getByRole("heading", { name: "日付別の学習ノート" }),
    ).toBeVisible();
  } finally {
    await memberContext.close();
  }
});

test(
  "wrong current passwords lock the change for a while",
  anyWidth,
  async ({ page, browser, baseURL, db }) => {
    await createMember(db, "taro", "太郎", "member-password-1");
    const hashBefore = (await account(db, "taro"))?.passwordHash;
    await asMember(page, "taro", "member-password-1");
    await page.goto("/account/password");

    // Better Auth's rate limit: 5 changes per 15 minutes from one address.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await fillChangeForm(
        page,
        `wrong-password-${attempt}`,
        "member-password-2",
      );
      // The message is the same every time, so wait for this attempt's count.
      await expect.poll(() => passwordChangeAttempts(db)).toEqual([attempt]);
      await expectAlert(page, currentPasswordMessage);
    }
    // Even the right current password is refused until the window ends.
    await fillChangeForm(page, "member-password-1", "member-password-2");
    await expectAlert(page, currentPasswordMessage);
    await expect(page).toHaveURL((url) => url.pathname === "/account/password");
    expect((await account(db, "taro"))?.passwordHash).toBe(hashBefore);

    // The lock is on changing the password only: signing in still works.
    const other = await browser.newContext({ baseURL });
    try {
      await asMember(await other.newPage(), "taro", "member-password-1");
    } finally {
      await other.close();
    }
  },
);

test(
  "mismatched and short new passwords are refused",
  anyWidth,
  async ({ page, db }) => {
    await createMember(db, "taro", "太郎", "member-password-1");
    const hashBefore = (await account(db, "taro"))?.passwordHash;
    await asMember(page, "taro", "member-password-1");
    await page.goto("/account/password");

    await fillChangeForm(
      page,
      "member-password-1",
      "member-password-2",
      "member-password-3",
    );
    await expectAlert(page, "確認用のパスワードが一致しません。");
    await fillChangeForm(page, "member-password-1", "short");
    await expectAlert(page, passwordLengthMessage);
    // Refused in the browser: nothing reached Better Auth.
    expect(await passwordChangeAttempts(db)).toEqual([]);
    expect((await account(db, "taro"))?.passwordHash).toBe(hashBefore);
  },
);
