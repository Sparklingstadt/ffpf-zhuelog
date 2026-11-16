import { type BrowserContext, type Page } from "@playwright/test";
import type { Client } from "pg";

import { goApiURL } from "./environment";
import {
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

async function refreshCookie(context: BrowserContext) {
  const cookies = await context.cookies();
  return cookies.find((c) => c.name === "zl_refresh")?.value;
}

async function account(db: Client, loginId: string) {
  const { rows } = await db.query(
    `SELECT "id", "displayName", "passwordHash", "sessionVersion"
       FROM "PasswordAccount" WHERE "loginId" = $1`,
    [loginId],
  );
  return rows[0] as
    | {
        id: string;
        displayName: string;
        passwordHash: string;
        sessionVersion: number;
      }
    | undefined;
}

async function passwordChangeAttempts(db: Client, accountId: string) {
  const { rows } = await db.query(
    `SELECT "count" FROM "SignInThrottle" WHERE "key" = 'password-change:' || $1::text`,
    [accountId],
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

test("member cannot open account management", async ({ page, db }) => {
  await createMember(db, "taro", "太郎", "member-password-1");
  await asMember(page, "taro", "member-password-1");
  await page.goto("/admin/accounts");
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(
    page.getByRole("heading", { name: "アカウント管理" }),
  ).toHaveCount(0);
});

test("wrong password shows one generic error", async ({ page, db }) => {
  await createMember(db, "taro", "太郎", "member-password-1");

  await signInWithPassword(page, "taro", "wrong-password-1");
  await expect(page).toHaveURL(/error=CredentialsSignin/);
  await expect(page.getByText(lockMessage)).toBeVisible();

  // An unknown ID gets exactly the same message.
  await signInWithPassword(page, "nobody", "wrong-password-1");
  await expect(page).toHaveURL(/error=CredentialsSignin/);
  await expect(page.getByText(lockMessage)).toBeVisible();
});

test("five failures pause that login ID for that client only", async ({
  browser,
  baseURL,
  db,
}) => {
  await createMember(db, "taro", "太郎", "member-password-1");
  // The app reads the client address from x-real-ip, which Vercel sets.
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
    for (let attempt = 0; attempt < 5; attempt += 1) {
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
});

test("reset revokes existing member sessions", async ({
  page,
  context,
  browser,
  baseURL,
  db,
}) => {
  await createMember(db, "taro", "太郎", "member-password-1");
  const memberContext = await browser.newContext({ baseURL });
  try {
    const memberPage = await memberContext.newPage();
    await asMember(memberPage, "taro", "member-password-1", "/logs");
    await expect(
      memberPage.getByRole("heading", { name: "日付別の学習ノート" }),
    ).toBeVisible();
    const refreshToken = await refreshCookie(memberContext);
    expect(refreshToken).toBeTruthy();

    await asAdmin(context);
    await page.goto("/admin/accounts");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "パスワードを再設定" }).click();
    const newPassword = await readOutputPassword(page);
    expect(newPassword).not.toBe("member-password-1");
    expect((await account(db, "taro"))?.sessionVersion).toBe(1);

    // Go still signs members in until stage 11; it sees the version the web
    // bumped and refuses the member's old refresh token.
    const refreshed = await fetch(`${goApiURL}/v1/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    expect(refreshed.status).toBe(401);

    await memberPage.goto("/logs");
    await expect(memberPage).toHaveURL(/\/signin/);

    // The old password no longer works; the reissued one does.
    await signInWithPassword(memberPage, "taro", "member-password-1");
    await expect(memberPage.getByText(lockMessage)).toBeVisible();
    await asMember(memberPage, "taro", newPassword, "/logs");
  } finally {
    await memberContext.close();
  }
});

test("member changes own password", async ({ page, db }) => {
  const accountId = await createMember(db, "taro", "太郎", "member-password-1");
  const hashBefore = (await account(db, "taro"))?.passwordHash;
  await asMember(page, "taro", "member-password-1");

  await page.goto("/account/password");
  await page.getByLabel("現在のパスワード").fill("member-password-1");
  await page
    .getByLabel("新しいパスワード", { exact: true })
    .fill("member-password-2");
  await page.getByLabel("新しいパスワード（確認）").fill("member-password-2");
  await page.getByRole("button", { name: "パスワードを変更" }).click();

  await expect(page).toHaveURL(/\/signin\?notice=password-changed/);
  await expect(
    page.getByText(
      "パスワードを変更しました。新しいパスワードでログインしてください。",
    ),
  ).toBeVisible();
  const after = await account(db, "taro");
  expect(after?.sessionVersion).toBe(1);
  expect(after?.passwordHash).not.toBe(hashBefore);
  expect(await passwordChangeAttempts(db, accountId)).toEqual([]);

  await signInWithPassword(page, "taro", "member-password-1");
  await expect(page.getByText(lockMessage)).toBeVisible();
  await asMember(page, "taro", "member-password-2");
});

test("the admin's form errors are the same", async ({ page, context, db }) => {
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
    `SELECT count(*)::int AS n FROM "PasswordAccount"`,
  );
  expect(rows[0].n).toBe(1);

  await page.getByLabel("taro の新しいパスワード").fill("short");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "パスワードを再設定" }).click();
  await expectAlert(page, passwordLengthMessage);
  expect((await account(db, "taro"))?.sessionVersion).toBe(0);
});

test("a created member signs in through Go with the password the web hashed", async ({
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
  expect(created?.passwordHash).toMatch(
    /^scrypt:32768:8:1:[\w-]{22}:[\w-]{86}$/,
  );
  expect(created?.sessionVersion).toBe(0);

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

test("wrong current passwords lock the change for a while", async ({
  page,
  browser,
  baseURL,
  db,
}) => {
  const accountId = await createMember(db, "taro", "太郎", "member-password-1");
  await asMember(page, "taro", "member-password-1");
  await page.goto("/account/password");

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await fillChangeForm(
      page,
      `wrong-password-${attempt}`,
      "member-password-2",
    );
    // The message is the same every time, so wait for this attempt's count.
    await expect
      .poll(() => passwordChangeAttempts(db, accountId))
      .toEqual([attempt]);
    await expectAlert(page, currentPasswordMessage);
  }
  // Even the right current password is refused until the window ends.
  await fillChangeForm(page, "member-password-1", "member-password-2");
  await expectAlert(page, currentPasswordMessage);
  await expect.poll(() => passwordChangeAttempts(db, accountId)).toEqual([6]);
  expect((await account(db, "taro"))?.sessionVersion).toBe(0);

  // The lock is on changing the password only: signing in still works.
  const other = await browser.newContext({ baseURL });
  try {
    await asMember(await other.newPage(), "taro", "member-password-1");
  } finally {
    await other.close();
  }
});

test("mismatched and short new passwords are refused", async ({ page, db }) => {
  const accountId = await createMember(db, "taro", "太郎", "member-password-1");
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
  expect(await passwordChangeAttempts(db, accountId)).toEqual([]);
  expect((await account(db, "taro"))?.sessionVersion).toBe(0);
});
