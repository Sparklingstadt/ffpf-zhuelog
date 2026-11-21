import {
  anyWidth,
  createMember,
  expect,
  memberOwnerId,
  practicePrepositionRound,
  seedNotes,
  test,
  upload,
} from "./fixtures";
import { baseURL, cronSecret, demoLoginId } from "./environment";
import type { Client } from "pg";

// Puts the demo account back to its fixture, as the nightly cron does. The
// db fixture empties the accounts before every test, so it runs each time.
async function resetDemo(method = "POST") {
  const response = await fetch(`${baseURL}/api/cron/demo-reset`, {
    method,
    headers: { authorization: `Bearer ${cronSecret()}` },
  });
  expect(response.status).toBe(204);
}

async function demoAccount(db: Client) {
  const { rows } = await db.query(
    `SELECT id, "passwordHash", "displayName", "sessionVersion"
       FROM "PasswordAccount" WHERE "loginId" = $1`,
    [demoLoginId],
  );
  expect(rows).toHaveLength(1);
  return rows[0] as {
    id: string;
    passwordHash: string;
    displayName: string;
    sessionVersion: number;
  };
}

async function count(db: Client, sql: string, values: unknown[]) {
  const { rows } = await db.query(sql, values);
  return rows[0].n as number;
}

const liveNotes = `SELECT count(*)::int AS n FROM "LearningEntry" WHERE "ownerId" = $1 AND "deletedAt" IS NULL`;
// Review items that name neither a note nor a word of their owner.
const orphanItems = `SELECT count(*)::int AS n FROM "ReviewItem" i WHERE i."ownerId" = $1
  AND NOT EXISTS (SELECT 1 FROM "LearningEntry" e WHERE i."kind" = 'entry' AND e."id" = i."targetId" AND e."ownerId" = i."ownerId")
  AND NOT EXISTS (SELECT 1 FROM "VocabularyEntry" v WHERE i."kind" = 'vocabulary' AND v."id" = i."targetId" AND v."ownerId" = i."ownerId")`;

test("the demo reset needs the cron secret", anyWidth, async () => {
  const response = await fetch(`${baseURL}/api/cron/demo-reset`, {
    method: "POST",
    headers: { authorization: "Bearer wrong" },
  });
  expect(response.status).toBe(401);
  expect(await response.text()).toBe(
    '{"error":{"code":"unauthorized","message":"認証が必要です。"}}',
  );
  // Vercel Cron calls with GET.
  await resetDemo("GET");
});

// Was Go's TestResetWithTheFixture (services/api/demo/demo_db_test.go, removed in stage 10b).
test("the reset seeds the demo as Go did", anyWidth, async ({ db }) => {
  await resetDemo();
  const account = await demoAccount(db);
  expect(account.passwordHash).toBe("demo:no-password");
  const owner = memberOwnerId(account.id);

  expect(await count(db, liveNotes, [owner])).toBe(12);
  expect(
    await count(
      db,
      `SELECT count(*)::int AS n FROM "VocabularyEntry" WHERE "ownerId" = $1`,
      [owner],
    ),
  ).toBe(10);
  expect(
    await count(
      db,
      `SELECT count(*)::int AS n FROM "ReviewItem" WHERE "ownerId" = $1 AND "due" <= now()`,
      [owner],
    ),
  ).toBeGreaterThan(0);
  expect(await count(db, orphanItems, [owner])).toBe(0);
  for (const table of [
    "ChatConversation",
    "PrepositionPracticeRecord",
    "ComplementPracticeRecord",
  ])
    expect(
      await count(
        db,
        `SELECT count(*)::int AS n FROM "${table}" WHERE "ownerId" = $1`,
        [owner],
      ),
      table,
    ).toBe(table === "ComplementPracticeRecord" ? 1 : 2);
  // Activity on most of the last seven Japan days.
  expect(
    await count(
      db,
      `SELECT count(DISTINCT ("at" + interval '9 hours')::date)::int AS n FROM (
         SELECT "createdAt" AS "at" FROM "LearningEntry" WHERE "ownerId" = $1 AND "deletedAt" IS NULL
         UNION ALL SELECT "createdAt" FROM "VocabularyEntry" WHERE "ownerId" = $1
         UNION ALL SELECT "createdAt" FROM "PrepositionPracticeRecord" WHERE "ownerId" = $1
         UNION ALL SELECT "createdAt" FROM "ComplementPracticeRecord" WHERE "ownerId" = $1
         UNION ALL SELECT "reviewedAt" FROM "ReviewLog" WHERE "ownerId" = $1) AS "activity"
       WHERE "at" >= now() - interval '8 days'`,
      [owner],
    ),
  ).toBeGreaterThanOrEqual(5);
});

// Go: TestResetDemoReplacesEverythingTheDemoOwns (store/demo_test.go).
test("the reset replaces only the demo's data", anyWidth, async ({ db }) => {
  await resetDemo();
  const before = await demoAccount(db);
  const owner = memberOwnerId(before.id);

  // What visitors did during the day: a note in review, a follow each way,
  // an AI call, a LINE link code; and a password change elsewhere bumped the
  // session version.
  await db.query(
    `INSERT INTO "ImportBatch" (id, "fileName", "rowCount") VALUES ('bvisitor', 'visitor.csv', 1)`,
  );
  await db.query(
    `INSERT INTO "LearningEntry" (id, "originalText", "correctedText", pinyin, "ownerId", "batchId")
     VALUES ('nvisitor', '訪問者', '访问者', 'fǎngwènzhě', $1, 'bvisitor')`,
    [owner],
  );
  await db.query(
    `INSERT INTO "ReviewItem" (id, "ownerId", language, kind, "targetId", due, "updatedAt")
     VALUES ('ivisitor', $1, 'zh', 'entry', 'nvisitor', now(), now())`,
    [owner],
  );
  const other = memberOwnerId(
    await createMember(db, "other-member", "Other", "member-password-1"),
  );
  await seedNotes(db, other, [{ text: "别人的笔记" }]);
  await db.query(
    `INSERT INTO "Follow" ("followerId", "followeeId") VALUES ($1, $2), ($2, $1)`,
    [owner, other],
  );
  await db.query(
    `INSERT INTO "AiUsage" (id, "ownerId", feature, model, "inputTokens", "outputTokens")
     VALUES ('uvisitor', $1, 'chat', 'gpt-test', 1, 1)`,
    [owner],
  );
  await db.query(
    `UPDATE "PasswordAccount" SET "sessionVersion" = 4 WHERE id = $1`,
    [before.id],
  );
  await db.query(
    `INSERT INTO "LineLinkCode" ("codeHash", "ownerId", role, "expiresAt")
     VALUES ('hvisitor', $1, 'member', now() + interval '10 minutes')`,
    [owner],
  );
  // Members' own follows and link codes, which the reset must leave alone.
  const third = memberOwnerId(
    await createMember(db, "third-member", "Third", "member-password-1"),
  );
  await db.query(
    `INSERT INTO "Follow" ("followerId", "followeeId") VALUES ($1, $2)`,
    [other, third],
  );
  await db.query(
    `INSERT INTO "LineLinkCode" ("codeHash", "ownerId", role, "expiresAt")
     VALUES ('hother', $1, 'member', now() + interval '10 minutes')`,
    [other],
  );

  await resetDemo();

  const after = await demoAccount(db);
  expect(after.id).toBe(before.id);
  expect(after.sessionVersion).toBe(4);
  expect(await count(db, liveNotes, [owner])).toBe(12);
  expect(
    await count(
      db,
      `SELECT count(*)::int AS n FROM "LearningEntry" WHERE id = 'nvisitor'`,
      [],
    ),
  ).toBe(0);
  expect(
    await count(
      db,
      `SELECT count(*)::int AS n FROM "ReviewItem" WHERE id = 'ivisitor'`,
      [],
    ),
  ).toBe(0);
  expect(await count(db, orphanItems, [owner])).toBe(0);
  expect(
    await count(
      db,
      `SELECT count(*)::int AS n FROM "Follow" WHERE "followerId" = $1 OR "followeeId" = $1`,
      [owner],
    ),
  ).toBe(0);
  expect(
    await count(
      db,
      `SELECT count(*)::int AS n FROM "LineLinkCode" WHERE "ownerId" = $1`,
      [owner],
    ),
  ).toBe(0);
  expect(
    await count(
      db,
      `SELECT count(*)::int AS n FROM "Follow" WHERE "followerId" = $1 AND "followeeId" = $2`,
      [other, third],
    ),
  ).toBe(1);
  expect(
    await count(
      db,
      `SELECT count(*)::int AS n FROM "LineLinkCode" WHERE "ownerId" = $1`,
      [other],
    ),
  ).toBe(1);
  expect(
    await count(
      db,
      `SELECT count(*)::int AS n FROM "AiUsage" WHERE "ownerId" = $1`,
      [owner],
    ),
  ).toBe(1);
  expect(await count(db, liveNotes, [other])).toBe(1);
});

// A member whose loginId is DEMO_LOGIN_ID is not overwritten (Go: ON CONFLICT
// DO NOTHING); the demo sign-in refuses it, as it has a real password.
test("an existing account keeps its password", anyWidth, async ({ db }) => {
  const id = await createMember(
    db,
    demoLoginId,
    "本当の会員",
    "member-password-1",
  );
  const { rows } = await db.query(
    `SELECT "passwordHash" FROM "PasswordAccount" WHERE id = $1`,
    [id],
  );
  await resetDemo();
  const after = await demoAccount(db);
  expect(after.id).toBe(id);
  expect(after.passwordHash).toBe(rows[0].passwordHash);
  expect(after.displayName).toBe("本当の会員");
  expect(await count(db, liveNotes, [memberOwnerId(id)])).toBe(12);
});

test("anyone can try the members' pages in the demo, without AI", async ({
  page,
  db,
}) => {
  await resetDemo();
  await page.goto("/signin");
  const demoButton = page.getByRole("button", { name: "デモで試す" });
  await expect(demoButton).toBeVisible();
  await expect(
    page.getByText("データは試している全員で共有され、毎晩元に戻ります。", {
      exact: false,
    }),
  ).toBeVisible();
  await demoButton.click();

  // Every page says it is the demo.
  await expect(page).toHaveURL(/\/$/);
  const banner = page.getByRole("status", { name: "デモアカウント" });
  await expect(banner).toContainText("デモアカウントです。");

  // The fixture's notes, reviews, words and conversations are there.
  await expect(page.getByTestId("review-due-count")).not.toHaveText("0");
  await expect(
    page.getByText("明日の会議は午後三時からです。").first(),
  ).toBeVisible();
  await page.goto("/logs");
  // Notes on several of the last seven days.
  await expect(page.getByText("2件の学習ノート").first()).toBeVisible();
  await expect(banner).toBeVisible();
  await page.goto("/vocabulary");
  await expect(page.getByText("图书馆", { exact: true }).first()).toBeVisible();
  await page.goto("/conversations");
  // Two days with a conversation each; the newest is the weekend plans.
  await expect(page.getByText("1件の会話")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "ChatGPT と話す" })).toHaveCount(
    0,
  );
  await page.getByText("1件の会話").first().click();
  await expect(page.getByText("週末の予定を話す")).toBeVisible();

  // The menu leaves out the AI features, follows, LINE and the password.
  await page
    .getByRole("banner")
    .getByRole("button", { name: /のメニュー$/ })
    .click();
  const menu = page.getByRole("menu", { name: "メニュー" });
  await expect(
    menu.getByRole("menuitem", { name: "会話ノート" }),
  ).toBeVisible();
  for (const name of [
    "ChatGPT と話す",
    "クイック質問",
    "フォロー",
    "LINE 連携",
    "パスワード変更",
  ])
    await expect(menu.getByRole("menuitem", { name })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The web refuses the AI routes to the demo, even when called directly.
  for (const path of ["/api/quick-question", "/api/chat"]) {
    const answer = await page.evaluate(async (path) => {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", text: "你好" }] }),
      });
      return { status: response.status, body: await response.json() };
    }, path);
    expect(answer.status, path).toBe(403);
    expect(answer.body.error.message, path).toBe("デモでは使えません。");
  }

  // The demo reads its own study log.
  await page.goto("/study-log");
  await expect(page.getByRole("heading", { name: "学習ログ" })).toBeVisible();
  await expect(
    page.getByText(
      "処理できませんでした。時間をおいてもう一度お試しください。",
    ),
  ).toHaveCount(0);

  // The demo has no follows: /follow sends it home.
  await page.goto("/follow");
  await expect(page).toHaveURL((url) => url.pathname === "/");

  // The demo has no password to change: the form is refused as forbidden.
  await page.goto("/account/password");
  await page.getByLabel("現在のパスワード").fill("member-password-1");
  await page
    .getByLabel("新しいパスワード", { exact: true })
    .fill("member-password-2");
  await page.getByLabel("新しいパスワード（確認）").fill("member-password-2");
  await page.getByRole("button", { name: "パスワードを変更" }).click();
  await expect(
    page.getByRole("alert").filter({
      hasText: "この操作を行う権限がありません。再度ログインしてください。",
    }),
  ).toBeVisible();
  const { rows } = await db.query(
    `SELECT "passwordHash" FROM "PasswordAccount" WHERE "loginId" = $1`,
    [demoLoginId],
  );
  expect(rows).toEqual([{ passwordHash: "demo:no-password" }]);

  // LINE is for members and admins: the demo is sent home.
  await page.goto("/account/line");
  await expect(page).toHaveURL((url) => url.pathname === "/");

  // Leaving the demo signs out.
  await banner.getByRole("button", { name: "デモを終える" }).click();
  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
});

// The demo is shared by strangers, so it cannot put a note on followers'
// timelines: the share button answers as for anyone who may not share.
test("the demo account cannot share", anyWidth, async ({ page, db }) => {
  await resetDemo();
  await page.goto("/signin");
  await page.getByRole("button", { name: "デモで試す" }).click();
  await expect(page).toHaveURL(/\/$/);

  // The demo's newest note: the last of its JST day.
  const { rows } = await db.query(
    `SELECT "correctedText", ("createdAt" + interval '9 hours')::date::text AS day
       FROM "LearningEntry" WHERE "deletedAt" IS NULL
      ORDER BY "createdAt" ASC, id ASC`,
  );
  const day = rows.at(-1).day as string;
  const sameDay = rows.filter((row) => row.day === day);
  const [year, month, date] = day.split("-").map(Number);
  await page.goto(`/logs/${year}/${month}/${date}/${sameDay.length}`);
  await expect(
    page.getByText(rows.at(-1).correctedText, { exact: true }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "共有する" }).click();
  await expect(page.getByText("ログインし直してください。")).toBeVisible();
  const shared = await db.query(
    `SELECT count(*)::int AS n FROM "LearningEntry" WHERE "sharedAt" IS NOT NULL`,
  );
  expect(shared.rows[0].n).toBe(0);
});

test("the demo account can import CSV", async ({ page, db }) => {
  await resetDemo();
  await page.goto("/signin");
  await page.getByRole("button", { name: "デモで試す" }).click();
  await expect(page).toHaveURL(/\/$/);

  await upload(page, "デモの原文,デモの添削,demo pinyin");
  await expect(page.getByText("1件の学習文を登録しました。")).toBeVisible();

  const account = await db.query(
    `SELECT id FROM "PasswordAccount" WHERE "loginId" = $1`,
    [demoLoginId],
  );
  const { rows } = await db.query(
    `SELECT "ownerId" FROM "LearningEntry" WHERE "originalText" = 'デモの原文'`,
  );
  expect(rows).toEqual([{ ownerId: memberOwnerId(account.rows[0].id) }]);
});

test("the demo account can answer a review", async ({ page, db }) => {
  await resetDemo();
  const account = await db.query(
    `SELECT id FROM "PasswordAccount" WHERE "loginId" = $1`,
    [demoLoginId],
  );
  const owner = memberOwnerId(account.rows[0].id);
  const logs = async () =>
    (
      await db.query(
        `SELECT count(*)::int AS n FROM "ReviewLog" WHERE "ownerId" = $1`,
        [owner],
      )
    ).rows[0].n as number;
  const before = await logs();

  await page.goto("/signin");
  await page.getByRole("button", { name: "デモで試す" }).click();
  await expect(page).toHaveURL(/\/$/);
  // The fixture's due cards are notes and words, both turned over.
  await page.goto("/review");
  await page.getByRole("button", { name: "めくる" }).click();
  await page
    .getByRole("group", { name: "思い出せた度合い" })
    .getByRole("button", { name: /^できた/ })
    .click();
  await expect.poll(logs).toBe(before + 1);
});

test("the demo account saves a practice round", async ({ page, db }) => {
  test.setTimeout(90_000);
  await resetDemo();
  const account = await db.query(
    `SELECT id FROM "PasswordAccount" WHERE "loginId" = $1`,
    [demoLoginId],
  );
  const owner = memberOwnerId(account.rows[0].id);
  const rounds = async () =>
    (
      await db.query(
        `SELECT count(*)::int AS n FROM "PrepositionPracticeRecord" WHERE "ownerId" = $1`,
        [owner],
      )
    ).rows[0].n as number;
  const before = await rounds();

  await page.goto("/signin");
  await page.getByRole("button", { name: "デモで試す" }).click();
  await expect(page).toHaveURL(/\/$/);
  await practicePrepositionRound(page);
  expect(await rounds()).toBe(before + 1);
});
