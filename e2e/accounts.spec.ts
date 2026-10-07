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

async function readOutputPassword(page: Page) {
  const output = page.locator("output");
  await expect(output).toContainText("この画面を離れると再表示できません");
  const text = (await output.innerText()).replace(/\s+/g, " ");
  const match = text.match(/パスワード: (\S+?)（/);
  if (!match) throw new Error(`Password not found in: ${text}`);
  return match[1];
}

test("admin creates a member who can use chat", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  await asAdmin(context);
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
    await asMember(memberPage, "taro", password, "/chat");
    await expect(
      memberPage.getByRole("heading", { name: "会話練習" }),
    ).toBeVisible();
    await expect(memberPage.getByText("太郎")).toBeVisible();
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

test("five failures lock the account", async ({ page, db }) => {
  await createMember(db, "taro", "太郎", "member-password-1");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await signInWithPassword(page, "taro", `wrong-password-${attempt}`);
    await expect(page.getByText(lockMessage)).toBeVisible();
  }

  // Even the correct password is refused while the account is locked.
  await signInWithPassword(page, "taro", "member-password-1");
  await expect(page.getByText(lockMessage)).toBeVisible();
  await expect(page).toHaveURL(/\/signin/);
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
    await asMember(memberPage, "taro", "member-password-1", "/chat");
    await expect(
      memberPage.getByRole("heading", { name: "会話練習" }),
    ).toBeVisible();

    await asAdmin(context);
    await page.goto("/admin/accounts");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "パスワードを再設定" }).click();
    const newPassword = await readOutputPassword(page);
    expect(newPassword).not.toBe("member-password-1");

    await memberPage.goto("/chat");
    await expect(memberPage).toHaveURL(/\/signin/);

    // The old password no longer works; the reissued one does.
    await signInWithPassword(memberPage, "taro", "member-password-1");
    await expect(memberPage.getByText(lockMessage)).toBeVisible();
    await asMember(memberPage, "taro", newPassword, "/chat");
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

test("member conversations are private", async ({
  page,
  browser,
  baseURL,
  db,
}) => {
  const accountId = await createMember(db, "taro", "太郎", "member-password-1");
  await db.query(
    `INSERT INTO "ChatConversation"
       ("id", "ownerId", "title", "modelName", "ended", "messages", "createdAt", "updatedAt")
     VALUES ($1, $2, '太郎の会話', 'gpt-6.1-sol', false, $3, NOW(), NOW())`,
    [
      "00000000-0000-4000-8000-000000000901",
      `password:${accountId}`,
      JSON.stringify([{ id: "m0", role: "user", text: "你好" }]),
    ],
  );

  await asMember(page, "taro", "member-password-1", "/conversations");
  await expect(page.getByText("1件の会話ノート")).toBeVisible();

  const adminContext = await browser.newContext({ baseURL });
  try {
    await asAdmin(adminContext);
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/conversations");
    await expect(
      adminPage.getByText("まだ会話ノートがありません"),
    ).toBeVisible();
    await expect(adminPage.getByText("1件の会話ノート")).toHaveCount(0);
  } finally {
    await adminContext.close();
  }
});
