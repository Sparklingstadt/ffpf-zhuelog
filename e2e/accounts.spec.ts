import { type Page } from "@playwright/test";
import {
  asAdmin,
  asMember,
  createMember,
  expect,
  signInWithPassword,
  test,
} from "./fixtures";

const lockMessage = "IDまたはパスワードが違うか、一時的にロックされています。";

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

    await asAdmin(context);
    await page.goto("/admin/accounts");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "パスワードを再設定" }).click();
    const newPassword = await readOutputPassword(page);
    expect(newPassword).not.toBe("member-password-1");

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
  await createMember(db, "taro", "太郎", "member-password-1");
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

  await signInWithPassword(page, "taro", "member-password-1");
  await expect(page.getByText(lockMessage)).toBeVisible();
  await asMember(page, "taro", "member-password-2");
});
