import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createHmac, randomBytes } from "node:crypto";
import { Client } from "pg";
import { ScryptPasswordHasher } from "../scripts/lib/scrypt-password-hasher";
import { baseURL, cookieName, databaseUrl, goJwtSecret } from "./environment";

export const test = base.extend<{ db: Client }>({
  // The Go API also limits /v1/auth/* to 10 calls a minute per client
  // address. That limit lives in its memory, so unlike the SignInThrottle
  // table (truncated below) it cannot be reset between tests. Give each test
  // its own address instead; locally the web takes it from X-Forwarded-For
  // and hands it to the Go API.
  extraHTTPHeaders: async ({ extraHTTPHeaders }, provide) => {
    const [a, b, c] = randomBytes(3);
    await provide({
      ...extraHTTPHeaders,
      "X-Forwarded-For": `10.${a}.${b}.${c}`,
    });
  },
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
          'TRUNCATE "PasswordAccount", "FfpfAccount", "Follow", "SignInThrottle", "ChatConversation", "QuickQuestion", "PrepositionPracticeRecord", "ComplementPracticeRecord"',
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

// The githubId that asAdmin puts in the session, and so the owner of the
// admin's notes.
export const adminOwnerId = "10001";

export async function asAdmin(context: BrowserContext) {
  await addAdminSession(context, {
    githubId: adminOwnerId,
    login: "e2e-admin",
  });
}

// Puts an admin session cookie in the context. Test-only cookie, signed with
// this run's random secret. No app auth bypass.
export async function addAdminSession(
  context: BrowserContext,
  admin: { githubId: string; login: string },
) {
  const value = goAccessToken({
    // The Go API puts the numeric GitHub id in sub.
    sub: admin.githubId,
    role: "admin",
    login: admin.login,
  });
  await context.addCookies([
    { name: cookieName, value, url: baseURL, httpOnly: true, sameSite: "Lax" },
  ]);
}

// An HS256 access token as services/api/auth/token.go issues it.
function goAccessToken(claims: { sub: string; role: string; login: string }) {
  const now = Math.floor(Date.now() / 1000);
  const encodePart = (part: object) =>
    Buffer.from(JSON.stringify(part)).toString("base64url");
  const unsigned = `${encodePart({ alg: "HS256", typ: "JWT" })}.${encodePart({
    iss: "ffpf-zhuelog-api",
    aud: ["ffpf-zhuelog-mobile"],
    iat: now,
    exp: now + 3600,
    ...claims,
  })}`;
  const signature = createHmac("sha256", goJwtSecret())
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
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
  await page.getByRole("button", { name: "ゲストとして使う" }).click();
  await expect(page.getByText("ゲスト", { exact: true })).toBeVisible();
}

// Imports on /import, opening it unless the page is already there (tests that
// change the session under an open form must not reload it).
export async function upload(page: Page, text: string, name = "learning.csv") {
  if (new URL(page.url()).pathname !== "/import") await page.goto("/import");
  await page
    .getByLabel("CSVファイル", { exact: true })
    .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
  await page
    .getByRole("button", { name: "CSVをインポート", exact: true })
    .click();
}

// The owner id the app derives for a password account.
export const memberOwnerId = (accountId: string) => `password:${accountId}`;

// Seeds learning notes straight into the database for one owner. Each text
// becomes a note whose original and corrected sentence are the same, so Typle
// takes words only from the hints (the quoted 「語」).
export async function seedNotes(
  db: Client,
  ownerId: string,
  notes: { text: string; hint?: string; createdAt?: string }[],
) {
  const batchId = `b${randomBytes(8).toString("hex")}`;
  await db.query(
    `INSERT INTO "ImportBatch" (id, "fileName", "rowCount") VALUES ($1, 'seed.csv', $2)`,
    [batchId, notes.length],
  );
  for (const note of notes) {
    const id = `n${randomBytes(8).toString("hex")}`;
    await db.query(
      `INSERT INTO "LearningEntry"
         (id, "originalText", "correctedText", pinyin, "createdAt", "ownerId", "batchId")
       VALUES ($1, $2, $2, 'pinyin', COALESCE($3::timestamp, NOW()), $4, $5)`,
      [id, note.text, note.createdAt ?? null, ownerId, batchId],
    );
    if (note.hint)
      await db.query(
        `INSERT INTO "Hint" (id, content, position, "learningEntryId") VALUES ($1, $2, 0, $3)`,
        [`h${randomBytes(8).toString("hex")}`, note.hint, id],
      );
  }
}
