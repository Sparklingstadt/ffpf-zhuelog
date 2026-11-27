import type { Page } from "@playwright/test";

import { sidIssuerURL } from "./environment";
import {
  adminOwnerId,
  anyWidth,
  asAdmin,
  asGuest,
  createMember,
  expect,
  memberOwnerId,
  practicePrepositionRound,
  seedNotes,
  signOut,
  test,
  upload,
} from "./fixtures";

const bannerOf = (page: Page) =>
  page.getByRole("status").filter({ hasText: "として操作中" });

// Asks Better Auth to impersonate userId from the page's own browser (its
// cookies), as a hand-made request would.
async function impersonateRequest(page: Page, userId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch("/api/auth/admin/impersonate-user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: id }),
    });
    return response.status;
  }, userId);
}

// The Sparklingstadt ID stub's record of /oauth/logout calls.
async function logoutCalls(method: "GET" | "DELETE" = "GET") {
  const response = await fetch(`${sidIssuerURL}/__logouts`, { method });
  return (await response.json()) as { idTokenHint: string | null }[];
}

test("an admin acting as a member saves the conversation as the member's", async ({
  page,
  context,
  db,
}) => {
  const accountId = await createMember(
    db,
    "test01",
    "テスト一郎",
    "member-password-1",
  );
  await asAdmin(context);
  await page.goto("/admin/accounts");
  await page.getByRole("button", { name: "この会員として操作" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  const banner = page.getByRole("status").filter({ hasText: "として操作中" });
  await expect(banner).toContainText("テスト一郎");
  await expect(banner).toContainText("test01");

  // The member's password is not the acting admin's to change.
  await page.goto("/account/password");
  await expect(page).toHaveURL((url) => url.pathname === "/");
  // Nor is the member's LINE link.
  await page.goto("/account/line");
  await expect(page).toHaveURL((url) => url.pathname === "/");

  // The chat is the member's, and so is its AI usage: impersonating, the
  // admin is the member.
  await page.goto("/chat");
  const input = page.getByLabel("ChatGPTへのメッセージ");
  await input.fill("我今天很忙");
  await input.press("Enter");
  await expect(
    page.getByRole("article", { name: "ChatGPTのメッセージ" }),
  ).toHaveText(["你好！「我今天很忙」ですね。"]);
  await expect(page).toHaveURL((url) => url.searchParams.has("id"));

  await expect
    .poll(async () => {
      const { rows } = await db.query(
        `SELECT "userId" FROM "ChatConversation"`,
      );
      return rows.map((row) => row.userId);
    })
    .toEqual([memberOwnerId(accountId)]);

  // Back as the admin, the conversation is not theirs.
  await banner.getByRole("button", { name: "管理者に戻る" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/admin/accounts");
  await expect(banner).toHaveCount(0);
  await page.goto("/conversations");
  await expect(page.getByText("まだ会話ノートがありません")).toBeVisible();
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM "ChatConversation" WHERE "userId" = $1`,
    [adminOwnerId],
  );
  expect(rows[0].n).toBe(0);
  // One usage row, the member's: none on the admin.
  const { rows: usage } = await db.query(
    `SELECT "userId" FROM "AiUsage" WHERE "feature" = 'chat'`,
  );
  expect(usage.map((row) => row.userId)).toEqual([memberOwnerId(accountId)]);
});

// The note and its OpenAI usage are both the member's.
test("an admin acting as a member asks as the member, and the usage is the member's", async ({
  page,
  context,
  db,
}) => {
  const accountId = await createMember(
    db,
    "test05",
    "テスト五郎",
    "member-password-1",
  );
  const member = memberOwnerId(accountId);
  await asAdmin(context);
  await page.goto("/admin/accounts");
  await page.getByRole("button", { name: "この会員として操作" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(
    page.getByRole("status").filter({ hasText: "として操作中" }),
  ).toContainText("テスト五郎");

  await page.goto("/quick-question");
  await page.getByLabel("クイック質問の内容").fill("了と过の違いは？");
  await page.getByRole("button", { name: "質問する", exact: true }).click();
  await expect(page.getByText("質問ノートに保存しました。")).toBeVisible();

  const { rows: notes } = await db.query(
    `SELECT "userId" FROM "QuickQuestion"`,
  );
  expect(notes).toEqual([{ userId: member }]);
  const { rows: usage } = await db.query(
    `SELECT "userId" FROM "AiUsage" WHERE "feature" = 'quick_question'`,
  );
  expect(usage).toEqual([{ userId: member }]);
});

test("an admin acting as a member saves a practice round as the member's", async ({
  page,
  context,
  db,
}) => {
  test.setTimeout(90_000);
  const accountId = await createMember(
    db,
    "test04",
    "テスト四郎",
    "member-password-1",
  );
  const owner = memberOwnerId(accountId);
  await asAdmin(context);
  await page.goto("/admin/accounts");
  await page.getByRole("button", { name: "この会員として操作" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(
    page.getByRole("status").filter({ hasText: "として操作中" }),
  ).toContainText("テスト四郎");

  await practicePrepositionRound(page);

  const { rows: records } = await db.query(
    `SELECT "userId", "questions" FROM "PrepositionPracticeRecord"`,
  );
  expect(records.map((row) => row.userId)).toEqual([owner]);
  // One review item per distinct `id:noun` target among the missed questions.
  const missedTargets = new Set(
    (records[0].questions as { id?: string; noun: string; misses: string[] }[])
      .filter((q) => q.id && q.misses.length > 0)
      .map((q) => `${q.id}:${q.noun}`),
  );
  const count = async (sql: string, ownerId: string) =>
    (await db.query(sql, [ownerId])).rows[0].n as number;
  const items = `SELECT count(*)::int AS n FROM "ReviewItem" WHERE "userId" = $1`;
  expect(await count(items, owner)).toBe(missedTargets.size);
  expect(await count(items, adminOwnerId)).toBe(0);
  expect(
    await count(
      `SELECT count(*)::int AS n FROM "PrepositionPracticeRecord" WHERE "userId" = $1`,
      adminOwnerId,
    ),
  ).toBe(0);
});

test("an admin acting as a member imports into the member's notes", async ({
  page,
  context,
  db,
}) => {
  const accountId = await createMember(
    db,
    "test03",
    "テスト三郎",
    "member-password-1",
  );
  await asAdmin(context);
  await page.goto("/admin/accounts");
  await page.getByRole("button", { name: "この会員として操作" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(
    page.getByRole("status").filter({ hasText: "として操作中" }),
  ).toContainText("テスト三郎");

  await upload(
    page,
    "原文1,添削1,pinyin 1,ヒントA,ヒントB\n原文2,添削2,pinyin 2",
    "member-notes.csv",
  );
  await expect(page.getByText("2件の学習文を登録しました。")).toBeVisible();

  const entries = await db.query(
    `SELECT "originalText", "userId", "batchId",
            (extract(epoch FROM "createdAt") * 1000)::bigint::text AS ms
       FROM "LearningEntry" ORDER BY "originalText"`,
  );
  expect(entries.rows.map((row) => [row.originalText, row.userId])).toEqual([
    ["原文1", memberOwnerId(accountId)],
    ["原文2", memberOwnerId(accountId)],
  ]);
  // The first row is the older one, by exactly 1 ms.
  expect(Number(entries.rows[1].ms) - Number(entries.rows[0].ms)).toBe(1);

  const batches = await db.query(
    `SELECT id, "fileName", "rowCount" FROM "ImportBatch"`,
  );
  expect(batches.rows).toEqual([
    { id: entries.rows[0].batchId, fileName: "member-notes.csv", rowCount: 2 },
  ]);
  expect(entries.rows[1].batchId).toBe(entries.rows[0].batchId);

  const hints = await db.query(
    `SELECT h.content, h.position FROM "Hint" h
       JOIN "LearningEntry" e ON e.id = h."learningEntryId"
      WHERE e."originalText" = '原文1' ORDER BY h.position`,
  );
  expect(hints.rows).toEqual([
    { content: "ヒントA", position: 0 },
    { content: "ヒントB", position: 1 },
  ]);
  expect(
    (await db.query('SELECT count(*)::int AS n FROM "Hint"')).rows[0].n,
  ).toBe(2);
});

test(
  "acting as a member is refused for a member who does not exist",
  anyWidth,
  async ({ page, context, db }) => {
    const accountId = await createMember(
      db,
      "test02",
      "テスト二郎",
      "member-password-1",
    );
    await asAdmin(context);
    await page.goto("/admin/accounts");
    await db.query(`DELETE FROM "user" WHERE id = $1`, [accountId]);
    await page.getByRole("button", { name: "この会員として操作" }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/admin/accounts" &&
        url.searchParams.get("actAs") === "failed",
    );
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "この会員として操作できませんでした" }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "として操作中" }),
    ).toHaveCount(0);
  },
);

test("an admin acting as a member reviews the member's queue", async ({
  page,
  context,
  db,
}) => {
  const accountId = await createMember(
    db,
    "test04",
    "テスト四郎",
    "member-password-1",
  );
  const member = memberOwnerId(accountId);
  await seedNotes(db, member, [
    { text: "我昨天去学校了。", createdAt: "2026-10-04T01:00:00Z" },
  ]);
  await asAdmin(context);
  await page.goto("/admin/accounts");
  await page.getByRole("button", { name: "この会員として操作" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(
    page.getByRole("status").filter({ hasText: "として操作中" }),
  ).toContainText("テスト四郎");

  await page.getByRole("button", { name: "復習に入れる" }).click();
  await expect(
    page.getByRole("button", { name: "復習から外す" }),
  ).toBeVisible();
  await page.goto("/review");
  await page.getByRole("button", { name: "めくる" }).click();
  await page
    .getByRole("group", { name: "思い出せた度合い" })
    .getByRole("button", { name: /^できた/ })
    .click();
  await expect(page.getByText("1問 復習しました")).toBeVisible();

  const items = await db.query(`SELECT "userId", reps FROM "ReviewItem"`);
  expect(items.rows).toEqual([{ userId: member, reps: 1 }]);
  const logs = await db.query(`SELECT "userId", rating FROM "ReviewLog"`);
  expect(logs.rows).toEqual([{ userId: member, rating: 3 }]);
  const own = await db.query(
    `SELECT count(*)::int AS n FROM "ReviewItem" WHERE "userId" = $1`,
    [adminOwnerId],
  );
  expect(own.rows[0].n).toBe(0);
});

test("an admin acting as a member reads the member's study log", async ({
  page,
  context,
  db,
}) => {
  const accountId = await createMember(
    db,
    "test01",
    "テスト一郎",
    "member-password-1",
  );
  await seedNotes(db, memberOwnerId(accountId), [{ text: "我今天学习了。" }]);
  await asAdmin(context);
  await page.goto("/admin/accounts");
  await page.getByRole("button", { name: "この会員として操作" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  const banner = page.getByRole("status").filter({ hasText: "として操作中" });
  await expect(banner).toContainText("テスト一郎");

  const totals = page.getByLabel("この月の合計");
  await page.goto("/study-log");
  await expect(totals).toContainText("ノート1件");

  // Back as the admin, the study log is the admin's own.
  await banner.getByRole("button", { name: "管理者に戻る" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/admin/accounts");
  await page.goto("/study-log");
  await expect(totals).toContainText("学習した日0日");
});

test("impersonating, the admin is the member: the member's notes, no admin pages, and back", async ({
  page,
  context,
  db,
}) => {
  const accountId = await createMember(
    db,
    "test06",
    "テスト六郎",
    "member-password-1",
  );
  await seedNotes(db, memberOwnerId(accountId), [
    { text: "会员的笔记。", createdAt: "2026-10-04T01:00:00Z" },
  ]);
  await seedNotes(db, adminOwnerId, [
    { text: "管理员的笔记。", createdAt: "2026-10-04T01:00:00Z" },
  ]);
  await asAdmin(context);
  await page.goto("/admin/accounts");
  await page.getByRole("button", { name: "この会員として操作" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(bannerOf(page)).toContainText("テスト六郎");
  // Better Auth's impersonation session, started by the admin.
  const { rows } = await db.query(
    `SELECT "impersonatedBy" FROM "session" WHERE "userId" = $1`,
    [accountId],
  );
  expect(rows).toEqual([{ impersonatedBy: adminOwnerId }]);

  await page.goto("/logs/2026/10/4");
  await expect(page.getByText("会员的笔记。").first()).toBeVisible();
  await expect(page.getByText("管理员的笔记。")).toHaveCount(0);

  // The admin's pages wait until the impersonation ends.
  for (const path of ["/admin/accounts", "/admin/ai-usage"]) {
    await page.goto(path);
    await expect(page).toHaveURL((url) => url.pathname === "/");
  }

  await bannerOf(page).getByRole("button", { name: "管理者に戻る" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/admin/accounts");
  await expect(bannerOf(page)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "アカウント管理" }),
  ).toBeVisible();
  await page.goto("/logs/2026/10/4");
  await expect(page.getByText("管理员的笔记。").first()).toBeVisible();
  // The impersonation session is gone.
  const { rows: left } = await db.query(
    `SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`,
    [accountId],
  );
  expect(left[0].n).toBe(0);
});

test(
  "impersonating, the member's password cannot be changed through Better Auth either",
  anyWidth,
  async ({ page, context, db }) => {
    const accountId = await createMember(
      db,
      "test07",
      "テスト七郎",
      "member-password-1",
    );
    const hash = async () =>
      (
        await db.query(
          `SELECT "password" FROM "account" WHERE "userId" = $1 AND "providerId" = 'credential'`,
          [accountId],
        )
      ).rows[0].password as string;
    const before = await hash();
    await asAdmin(context);
    await page.goto("/admin/accounts");
    await page.getByRole("button", { name: "この会員として操作" }).click();
    await expect(bannerOf(page)).toContainText("テスト七郎");

    const status = await page.evaluate(async () => {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: "member-password-1",
          newPassword: "admin-chosen-password-1",
          revokeOtherSessions: true,
        }),
      });
      return response.status;
    });
    expect(status).toBe(403);
    expect(await hash()).toBe(before);
    // Still the impersonation, not an ordinary session of the member.
    await page.reload();
    await expect(bannerOf(page)).toContainText("テスト七郎");
  },
);

test(
  "a guest is never impersonated, and only an admin learns that it is a guest",
  anyWidth,
  async ({ page, context, browser, baseURL, db }) => {
    // A guest's user, made by signing in as a guest.
    const guestContext = await browser.newContext({ baseURL });
    try {
      await asGuest(await guestContext.newPage());
    } finally {
      await guestContext.close();
    }
    const { rows } = await db.query(
      `SELECT "id" FROM "user" WHERE "isAnonymous" = true`,
    );
    expect(rows).toHaveLength(1);
    const guestId = rows[0].id as string;

    // Signed out, the admin plugin answers before the target is looked up.
    await page.goto("/signin");
    expect(await impersonateRequest(page, guestId)).toBe(401);

    // The admin, from their own browser, is refused.
    await asAdmin(context);
    await page.goto("/");
    expect(await impersonateRequest(page, guestId)).toBe(403);
    const { rows: sessions } = await db.query(
      `SELECT count(*)::int AS n FROM "session" WHERE "impersonatedBy" IS NOT NULL`,
    );
    expect(sessions[0].n).toBe(0);
    await page.reload();
    await expect(bannerOf(page)).toHaveCount(0);
  },
);

test(
  "signing out while impersonating a Sparklingstadt ID member never ends the member's ID server session",
  anyWidth,
  async ({ page, context, db }) => {
    // A Sparklingstadt ID member, with the ID token of their last sign-in.
    const memberId = "e2esidmember0000000000000000000a";
    await db.query(
      `INSERT INTO "user" ("id", "name", "email", "emailVerified", "role", "updatedAt")
       VALUES ($1, 'SID会員', 'sid-member@example.com', true, 'user', NOW())`,
      [memberId],
    );
    await db.query(
      `INSERT INTO "account" ("id", "accountId", "providerId", "userId", "idToken", "updatedAt")
       VALUES ('e2esidmemberaccount', 'member-sub', 'sid', $1, 'member-id-token', NOW())`,
      [memberId],
    );
    await asAdmin(context);
    await page.goto("/admin/accounts");
    await page.getByRole("button", { name: "この会員として操作" }).click();
    await expect(bannerOf(page)).toContainText("SID会員");

    await logoutCalls("DELETE");
    await signOut(page);
    await expect(page).toHaveURL(/\/signin(?:\?|$)/);

    // The admin was signed out as the admin: never with the member's ID token.
    const calls = await logoutCalls();
    expect(calls.map((call) => call.idTokenHint)).not.toContain(
      "member-id-token",
    );
    expect(
      (await db.query(`SELECT count(*)::int AS n FROM "session"`)).rows[0].n,
    ).toBe(0);
    await page.goto("/admin/accounts");
    await expect(page).toHaveURL(/\/signin/);
  },
);
