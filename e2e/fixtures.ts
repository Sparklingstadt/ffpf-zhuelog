import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { randomBytes } from "node:crypto";
import { encode } from "next-auth/jwt";
import { Client } from "pg";
import { ScryptPasswordHasher } from "../src/infrastructure/auth/scrypt-password-hasher";
import { authSecret, baseURL, cookieName, databaseUrl } from "./environment";

export const test = base.extend<{ db: Client }>({
  db: [
    async ({}, provide) => {
      const db = new Client({ connectionString: databaseUrl });
      await db.connect();
      try {
        // Prisma stores timestamp-without-time-zone values in UTC. Keep NOW()
        // in fixture SQL consistent on developer machines and CI.
        await db.query("SET TIME ZONE 'UTC'");
        const { rows } = await db.query("SELECT current_database() AS name");
        if (rows[0].name !== "zhuelog_e2e")
          throw new Error("Refusing to reset a non-E2E database");
        await db.query(
          'TRUNCATE "LineLearningJob", "LineDevelopmentSession", "ChatConversation", "PasswordAccount"',
        );
        await db.query(
          'TRUNCATE "Hint", "LearningEntry", "ImportBatch" CASCADE',
        );
        await provide(db);
      } finally {
        await db.end();
      }
    },
    { auto: true },
  ],
});
export { expect };

export async function asAdmin(context: BrowserContext) {
  // Test-only cookie, signed with this run's random secret. No app auth bypass.
  const value = await encode({
    secret: authSecret(),
    salt: cookieName,
    maxAge: 3600,
    token: {
      // Same shape as a real GitHub sign-in: Auth.js puts a random UUID in
      // sub, and the app stores the numeric GitHub id in its own claim.
      sub: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
      githubId: "10001",
      name: "E2E Admin",
      role: "admin",
      githubLogin: "e2e-admin",
    },
  });
  await context.addCookies([
    { name: cookieName, value, url: baseURL, httpOnly: true, sameSite: "Lax" },
  ]);
}

export async function signInWithPassword(
  page: Page,
  loginId: string,
  password: string,
  callback = "/",
) {
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(callback)}`);
  await page.getByLabel("ログインID").fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByRole("button", { name: "IDとパスワードでログイン" }).click();
}

// Signs in through the real form and waits until the redirect has landed.
export async function asMember(
  page: Page,
  loginId: string,
  password: string,
  callback = "/",
) {
  await signInWithPassword(page, loginId, password, callback);
  await expect(page).toHaveURL(
    (url) => url.pathname === callback.split("?")[0],
  );
}

// Inserts a password account directly (faster than the admin UI) and returns
// its id. The hash is the same one the app verifies at sign-in. The id mimics
// a Prisma cuid (lowercase alphanumerics) because the app rejects other shapes.
export async function createMember(
  db: Client,
  loginId: string,
  displayName: string,
  password: string,
) {
  const passwordHash = await new ScryptPasswordHasher().hash(password);
  const { rows } = await db.query(
    `INSERT INTO "PasswordAccount"
       ("id", "loginId", "displayName", "passwordHash", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING "id"`,
    [`c${randomBytes(12).toString("hex")}`, loginId, displayName, passwordHash],
  );
  return rows[0].id as string;
}

export async function asGuest(page: Page, callback = "/") {
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(callback)}`);
  await page.getByRole("button", { name: "ゲストとして閲覧" }).click();
  await expect(page.getByText("ゲスト（共有ノートは閲覧のみ）")).toBeVisible();
}

export async function upload(page: Page, text: string, name = "learning.csv") {
  await page
    .getByLabel("CSVファイル", { exact: true })
    .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
  await page
    .getByRole("button", { name: "CSVをインポート", exact: true })
    .click();
}
