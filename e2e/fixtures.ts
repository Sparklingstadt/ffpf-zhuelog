import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import {
  memberEmail,
  normalizeUsername,
} from "../src/infrastructure/auth/better-auth-rules";
import { ScryptPasswordHasher } from "../src/infrastructure/security/scrypt-password-hasher";
import { databaseUrl, demoLoginId, demoPassword } from "./environment";
import { sidStubUser } from "./fixtures/sid-oidc-stub";

export const test = base.extend<{ db: Client }>({
  // Each test gets its own client address, so Better Auth's rate limit (by
  // address and path) never carries over within a test file's flow.
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
        // Better Auth's tables (users, their sessions and accounts, the rate
        // limit's counters) and everything the users own.
        await db.query(
          'TRUNCATE "user", "session", "account", "verification", "rateLimit", "Follow", "ChatConversation", "QuickQuestion", "PrepositionPracticeRecord", "ComplementPracticeRecord", "ReviewLog", "ReviewItem", "VocabularyEntry", "AiUsage", "LineLink", "LineLinkCode", "LineMessage", "Hint", "LearningEntry", "ImportBatch" CASCADE',
        );
        // The administrator is there from the start, so a test can seed the
        // admin's notes before signing in (asAdmin links the sign-in).
        await createAdminUser(db);
        await provide(db);
      } finally {
        await db.end();
      }
    },
    { auto: true },
  ],
});
export { expect };

// For tests of what the server does (redirects, validation, permissions,
// headers, what a webhook or a cron writes): the result is the same at any
// width, so only the desktop project runs them (playwright.config.ts). Tests
// that go through menus or check that something fits stay untagged and run
// at both widths.
export const anyWidth = { tag: "@any-width" } as const;

// The user id of the administrator asAdmin signs in as, and so the owner of
// the admin's notes.
export const adminOwnerId = "e2eadmin";
export const adminDisplayName = "e2e-admin";

// A user id of the shape Better Auth makes (32 letters and digits).
function newUserId() {
  return randomBytes(16).toString("hex");
}

// The administrator: a "user" with role "admin". Its mail address is not the
// Sparklingstadt ID stub's, so a test that signs in through the stub as a new
// member never meets it (Better Auth never links by mail address here).
async function createAdminUser(db: Client) {
  await db.query(
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "role", "updatedAt")
     VALUES ($1, $2, $3, true, 'admin', NOW())
     ON CONFLICT ("id") DO NOTHING`,
    [adminOwnerId, adminDisplayName, "e2e-admin@admin.zhuelog.invalid"],
  );
}

// Signs the context in as the administrator: the Sparklingstadt ID stub's
// user is linked to the admin "user" by a "sid" account (accountId = the
// stub's sub), as the migration links the real administrator, and the
// context signs in through the real Sparklingstadt ID button. Until then the
// stub's user is an ordinary new member (sid-login.spec.ts). Opens its own
// connection so the many callers need not take the db fixture.
export async function asAdmin(context: BrowserContext) {
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await createAdminUser(db);
    await db.query(
      `INSERT INTO "account" ("id", "accountId", "providerId", "userId", "updatedAt")
       SELECT $1, $2, 'sid', $3, NOW()
        WHERE NOT EXISTS (SELECT 1 FROM "account" WHERE "providerId" = 'sid' AND "accountId" = $2)`,
      [newUserId(), sidStubUser.sub, adminOwnerId],
    );
  } finally {
    await db.end();
  }
  const page = await context.newPage();
  try {
    await page.goto("/signin");
    await page
      .getByRole("button", { name: "Sparklingstadt ID でログイン" })
      .click();
    await expect(page).toHaveURL((url) => url.pathname === "/");
  } finally {
    await page.close();
  }
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

// Inserts a member directly (faster than the admin UI) and returns its user
// id: a "user" with the normalized login id as its username and its member
// mail address, and a credential account holding the scrypt hash the app
// verifies at sign-in.
export async function createMember(
  db: Client,
  loginId: string,
  displayName: string,
  password: string,
) {
  const username = normalizeUsername(loginId);
  const userId = newUserId();
  await db.query(
    `INSERT INTO "user" ("id", "name", "email", "username", "displayUsername", "role", "updatedAt")
     VALUES ($1, $2, $3, $4, $4, 'user', NOW())`,
    [userId, displayName, memberEmail(username), username],
  );
  await db.query(
    `INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "updatedAt")
     VALUES ($1, $2, 'credential', $2, $3, NOW())`,
    [newUserId(), userId, await new ScryptPasswordHasher().hash(password)],
  );
  return userId;
}

// The demo account (DEMO_LOGIN_ID) with this run's DEMO_PASSWORD, which the
// demo button signs in with. Returns its user id.
export function createDemoMember(db: Client, displayName = "デモ") {
  return createMember(db, demoLoginId, displayName, demoPassword());
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

// Records are owned by the user id itself.
export const memberOwnerId = (userId: string) => userId;

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
         (id, "originalText", "correctedText", pinyin, "createdAt", "userId", "batchId")
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

// Opens the menu from the header's name button (every width) and returns it.
// Pages and settings that are not main tabs are only linked from here.
export async function openSiteMenu(page: Page) {
  await page
    .getByRole("banner")
    .getByRole("button", { name: /のメニュー$/ })
    .click();
  const menu = page.getByRole("menu", { name: "メニュー" });
  await expect(menu).toBeVisible();
  return menu;
}

// Picks the choices in order until the right one, so most rounds miss some.
export async function pickUntilRight(page: Page, groupName: string) {
  const choices = page.getByRole("group", { name: groupName });
  for (const button of await choices.getByRole("button").all()) {
    await button.click();
    if (await choices.getByRole("button", { name: /（正解）$/ }).count())
      return;
  }
}

// Plays one round of 25 preposition questions with pickUntilRight and waits
// until the round is saved.
export async function practicePrepositionRound(page: Page) {
  const questionCount = 25;
  await page.goto("/practice/prepositions");
  for (let i = 0; i < questionCount; i++) {
    await expect(
      page.getByRole("progressbar", { name: "進捗" }),
    ).toHaveAttribute("aria-valuenow", String(i));
    await pickUntilRight(page, "介詞を選ぶ");
    await page
      .getByRole("button", {
        name: i + 1 < questionCount ? "次へ" : "結果を見る",
      })
      .click();
  }
  await expect(page.getByText("記録に保存しました。")).toBeVisible();
}

export async function signOut(page: Page) {
  const menu = await openSiteMenu(page);
  await menu.getByRole("menuitem", { name: "ログアウト" }).click();
}
