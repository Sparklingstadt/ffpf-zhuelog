import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { encode } from "next-auth/jwt";
import { Client } from "pg";
import { authSecret, baseURL, cookieName, databaseUrl } from "./environment";

export const test = base.extend<{ db: Client }>({
  db: [
    async ({}, provide) => {
      const db = new Client({ connectionString: databaseUrl });
      await db.connect();
      try {
        const { rows } = await db.query("SELECT current_database() AS name");
        if (rows[0].name !== "zhuelog_e2e")
          throw new Error("Refusing to reset a non-E2E database");
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
      sub: "e2e-admin",
      name: "E2E Admin",
      role: "admin",
      githubLogin: "e2e-admin",
    },
  });
  await context.addCookies([
    { name: cookieName, value, url: baseURL, httpOnly: true, sameSite: "Lax" },
  ]);
}

export async function asGuest(page: Page, callback = "/") {
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(callback)}`);
  await page.getByRole("button", { name: "ゲストとして閲覧" }).click();
  await expect(page.getByText("ゲスト（閲覧のみ）")).toBeVisible();
}

export async function upload(page: Page, text: string, name = "learning.csv") {
  await page
    .getByLabel("CSVファイル", { exact: true })
    .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
  await page
    .getByRole("button", { name: "CSVをインポート", exact: true })
    .click();
}
