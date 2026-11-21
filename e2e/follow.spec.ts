import type { Browser, Page } from "@playwright/test";
import {
  adminOwnerId,
  anyWidth,
  asAdmin,
  asGuest,
  asMember,
  createMember,
  expect,
  memberOwnerId,
  openSiteMenu,
  seedNotes,
  test,
} from "./fixtures";

const password = "member-password-1";
const detail = "/logs/2026/10/4/1";
const notes = [
  { text: "A1原文", createdAt: "2026-10-04T01:00:00Z", hint: "「一」" },
  { text: "A2原文", createdAt: "2026-10-04T02:00:00Z", hint: "「二」" },
];

async function signedInPage(
  browser: Browser,
  baseURL: string | undefined,
  loginId: string,
  callback: string,
) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await asMember(page, loginId, password, callback);
  return { context, page };
}

// A note's card summary, which shows its original text once.
const note = (page: Page, text: string) =>
  page.locator("details summary").filter({ hasText: text });

const memberRow = (page: Page, name: string) =>
  page.getByRole("listitem", { name });

test("a follower sees only the notes shared with them", async ({
  browser,
  baseURL,
  db,
}) => {
  const taro = await createMember(db, "taro", "太郎", password);
  await createMember(db, "hanako", "花子", password);
  await seedNotes(db, memberOwnerId(taro), notes);

  const a = await signedInPage(browser, baseURL, "taro", detail);
  const b = await signedInPage(browser, baseURL, "hanako", "/follow");
  try {
    // A shares the first note only.
    await a.page.getByRole("button", { name: "共有する" }).click();
    await expect(
      a.page.getByText("共有中（フォロワーが見られます）"),
    ).toBeVisible();
    await expect(
      a.page.getByRole("button", { name: "共有をやめる" }),
    ).toBeVisible();

    // B follows A and sees only the shared note.
    const taroRow = memberRow(b.page, "太郎");
    await expect(taroRow).toContainText("太郎");
    // Members see display names only, never another member's login ID.
    await expect(taroRow).not.toContainText("taro");
    await taroRow.getByRole("button", { name: "フォローする" }).click();
    await expect(
      taroRow.getByRole("button", { name: "フォロー解除" }),
    ).toBeVisible();
    await expect(
      b.page.getByText("フォロー中 1人・フォロワー 0人"),
    ).toBeVisible();
    await expect(b.page.getByText("太郎さん・")).toBeVisible();
    await expect(note(b.page, "A1原文")).toBeVisible();
    await expect(note(b.page, "A2原文")).toHaveCount(0);
    // The timeline links nowhere: the detail page is for the owner.
    await expect(
      b.page.getByRole("link", { name: "ノートを開く" }),
    ).toHaveCount(0);

    // A sees that B follows them.
    await a.page.goto("/follow");
    await expect(memberRow(a.page, "花子")).toContainText(
      "フォローされています",
    );
    await expect(
      a.page.getByText("フォロー中 0人・フォロワー 1人"),
    ).toBeVisible();

    // Unfollowing empties B's timeline.
    await memberRow(b.page, "太郎")
      .getByRole("button", { name: "フォロー解除" })
      .click();
    await expect(note(b.page, "A1原文")).toHaveCount(0);
    await expect(
      b.page.getByText("共有されたノートはまだありません。"),
    ).toBeVisible();
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("unsharing or trashing a note removes it from the timeline", async ({
  browser,
  baseURL,
  db,
}) => {
  const taro = await createMember(db, "taro", "太郎", password);
  await createMember(db, "hanako", "花子", password);
  await seedNotes(db, memberOwnerId(taro), notes);

  const a = await signedInPage(browser, baseURL, "taro", detail);
  const b = await signedInPage(browser, baseURL, "hanako", "/follow");
  try {
    await a.page.getByRole("button", { name: "共有する" }).click();
    await expect(
      a.page.getByRole("button", { name: "共有をやめる" }),
    ).toBeVisible();
    await a.page.goto("/logs/2026/10/4/2");
    await a.page.getByRole("button", { name: "共有する" }).click();
    await expect(
      a.page.getByRole("button", { name: "共有をやめる" }),
    ).toBeVisible();

    await memberRow(b.page, "太郎")
      .getByRole("button", { name: "フォローする" })
      .click();
    await expect(note(b.page, "A1原文")).toBeVisible();
    await expect(note(b.page, "A2原文")).toBeVisible();

    // Unsharing A1 removes only A1.
    await a.page.goto(detail);
    await a.page.getByRole("button", { name: "共有をやめる" }).click();
    await expect(
      a.page.getByRole("button", { name: "共有する" }),
    ).toBeVisible();
    await b.page.reload();
    await expect(note(b.page, "A1原文")).toHaveCount(0);
    await expect(note(b.page, "A2原文")).toBeVisible();

    // Trashing A2 takes it off the timeline too.
    await a.page.goto("/logs/2026/10/4/2");
    await a.page.getByRole("button", { name: "ゴミ箱に入れる" }).click();
    // The trash has committed once A lands on the day's list.
    await expect(a.page).toHaveURL("/logs/2026/10/4?trashed=1");
    await b.page.reload();
    await expect(note(b.page, "A2原文")).toHaveCount(0);
    await expect(
      b.page.getByText("共有されたノートはまだありません。"),
    ).toBeVisible();
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("guests get no follow link and are sent home from /follow", async ({
  page,
}) => {
  await asGuest(page);
  await expect(
    (await openSiteMenu(page)).getByRole("menuitem", { name: "フォロー" }),
  ).toHaveCount(0);
  await page.goto("/follow");
  await expect(page).toHaveURL((url) => url.pathname === "/");
});

test("an admin can follow a member but has no share button", async ({
  page,
  context,
  db,
}) => {
  const taro = await createMember(db, "taro", "太郎", password);
  await seedNotes(db, memberOwnerId(taro), notes);
  await db.query(
    `UPDATE "LearningEntry" SET "sharedAt" = NOW() WHERE "originalText" = 'A1原文'`,
  );
  await asAdmin(context);

  await page.goto("/");
  await (
    await openSiteMenu(page)
  )
    .getByRole("menuitem", { name: "フォロー" })
    .click();
  await expect(page).toHaveURL("/follow");
  await memberRow(page, "太郎")
    .getByRole("button", { name: "フォローする" })
    .click();
  await expect(note(page, "A1原文")).toBeVisible();
  await expect(note(page, "A2原文")).toHaveCount(0);

  await seedNotes(db, adminOwnerId, [notes[0]]);
  await page.goto(detail);
  await expect(note(page, "A1原文")).toBeVisible();
  await expect(page.getByRole("button", { name: "共有する" })).toHaveCount(0);
});

test(
  "a member cannot share another member's note by forging its id",
  anyWidth,
  async ({ browser, baseURL, db }) => {
    const taro = await createMember(db, "taro", "太郎", password);
    const hanako = await createMember(db, "hanako", "花子", password);
    await seedNotes(db, memberOwnerId(taro), [notes[0]]);
    await seedNotes(db, memberOwnerId(hanako), [
      { text: "B1原文", createdAt: "2026-10-04T01:00:00Z", hint: "「一」" },
    ]);
    const { rows } = await db.query(
      `SELECT id FROM "LearningEntry" WHERE "ownerId" = $1`,
      [memberOwnerId(taro)],
    );
    const taroNoteId = rows[0].id as string;

    const b = await signedInPage(browser, baseURL, "hanako", detail);
    try {
      // B's own form, with the hidden id swapped for A's note.
      await expect(note(b.page, "B1原文")).toBeVisible();
      await b.page
        .locator('form:has(button:text-is("共有する")) input[name="id"]')
        .evaluate((input, id) => {
          (input as HTMLInputElement).value = id;
        }, taroNoteId);
      await b.page.getByRole("button", { name: "共有する" }).click();
      await expect(
        b.page.getByText("見つかりませんでした。画面を更新してください。"),
      ).toBeVisible();

      const shared = await db.query(
        `SELECT "sharedAt" FROM "LearningEntry" WHERE id = $1`,
        [taroNoteId],
      );
      expect(shared.rows[0].sharedAt).toBeNull();
    } finally {
      await b.context.close();
    }
  },
);

test(
  "members are listed in Japanese order, then by when they joined",
  anyWidth,
  async ({ page, db }) => {
    await createMember(db, "viewer", "閲覧者", password);
    const names = [
      "カズ",
      "サーシャ",
      "アキラ",
      "コーヘイ",
      "イチロー",
      "ケーキ",
      "コウヘイ",
      "ダブル",
      "ダブル",
    ];
    const ids: string[] = [];
    for (const [index, name] of names.entries())
      ids.push(await createMember(db, `m${index + 1}`, name, password));
    // m9 was created after m8 but joined earlier, so it comes first.
    const joined = [
      "2026-10-01 00:00:01",
      "2026-10-01 00:00:02",
      "2026-10-01 00:00:03",
      "2026-10-01 00:00:04",
      "2026-10-01 00:00:05",
      "2026-10-01 00:00:06",
      "2026-10-01 00:00:07",
      "2026-10-01 00:00:20",
      "2026-10-01 00:00:10",
    ];
    for (const [index, id] of ids.entries())
      await db.query(
        `UPDATE "PasswordAccount" SET "createdAt" = $2 WHERE "id" = $1`,
        [id, joined[index]],
      );

    await asMember(page, "viewer", password, "/follow");
    const listed = await page
      .locator('li input[name="followeeId"]')
      .evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).value),
      );
    // アキラ, イチロー, カズ, ケーキ, コウヘイ, コーヘイ, サーシャ, ダブル ×2.
    expect(listed).toEqual(
      [3, 5, 1, 6, 7, 4, 2, 9, 8].map((m) => memberOwnerId(ids[m - 1])),
    );
    await expect(memberRow(page, "閲覧者")).toHaveCount(0);
  },
);

test(
  "the timeline shows the newest 100 shared notes of followed members",
  anyWidth,
  async ({ page, db }) => {
    const taro = await createMember(db, "taro", "太郎", password);
    const hanako = await createMember(db, "hanako", "花子", password);
    const jiro = await createMember(db, "jiro", "次郎", password);
    const start = Date.parse("2026-10-01T00:00:00Z");
    await seedNotes(
      db,
      memberOwnerId(taro),
      Array.from({ length: 101 }, (_, index) => ({
        text: `共有${String(index + 1).padStart(3, "0")}`,
        createdAt: new Date(start + (index + 1) * 60_000).toISOString(),
        hint: "一番目",
      })),
    );
    await db.query(
      `UPDATE "LearningEntry" SET "sharedAt" = NOW() WHERE "ownerId" = $1`,
      [memberOwnerId(taro)],
    );
    const { rows } = await db.query(
      `SELECT id FROM "LearningEntry" WHERE "originalText" = '共有101'`,
    );
    await db.query(
      `INSERT INTO "Hint" (id, content, position, "learningEntryId") VALUES ('hsecond', '二番目', 1, $1)`,
      [rows[0].id],
    );

    // Left out: a member not followed, a trashed note and a deleted member.
    await seedNotes(db, memberOwnerId(jiro), [{ text: "次郎の共有" }]);
    await seedNotes(db, memberOwnerId(taro), [
      { text: "捨てた共有", createdAt: "2026-12-01T00:00:00Z" },
    ]);
    const gone = "password:gone00000000000000000000";
    await seedNotes(db, gone, [
      { text: "消えた人の共有", createdAt: "2026-12-01T00:00:00Z" },
    ]);
    await db.query(
      `UPDATE "LearningEntry" SET "sharedAt" = NOW() WHERE "originalText" IN ('次郎の共有', '捨てた共有', '消えた人の共有')`,
    );
    await db.query(
      `UPDATE "LearningEntry" SET "deletedAt" = NOW() WHERE "originalText" = '捨てた共有'`,
    );
    await db.query(
      `INSERT INTO "Follow" ("followerId", "followeeId") VALUES ($1, $2), ($1, $3)`,
      [memberOwnerId(hanako), memberOwnerId(taro), gone],
    );

    await asMember(page, "hanako", password, "/follow");
    await expect(page.locator("details summary")).toHaveCount(100);
    await expect(page.locator("details summary").first()).toContainText(
      "共有101",
    );
    await expect(note(page, "共有002")).toBeVisible();
    await expect(note(page, "共有001")).toHaveCount(0);
    for (const text of ["次郎の共有", "捨てた共有", "消えた人の共有"])
      await expect(page.getByText(text)).toHaveCount(0);

    // Hints come in position order (cards start open).
    const card = page.locator("details").filter({
      has: page.locator("summary", { hasText: "共有101" }),
    });
    await expect(card.getByText("二番目")).toBeVisible();
    const text = await card.innerText();
    expect(text.indexOf("一番目")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("一番目")).toBeLessThan(text.indexOf("二番目"));
  },
);

test("an admin acting as a member follows as the member", async ({
  browser,
  baseURL,
  page,
  context,
  db,
}) => {
  const test01 = await createMember(db, "test01", "テスト一郎", password);
  const taro = await createMember(db, "taro", "太郎", password);
  const followersOfTaro = async () =>
    (
      await db.query(
        `SELECT "followerId", EXTRACT(EPOCH FROM "createdAt")::float8 * 1000 AS ms
         FROM "Follow" WHERE "followeeId" = $1 ORDER BY "followerId"`,
        [memberOwnerId(taro)],
      )
    ).rows as { followerId: string; ms: number }[];

  await asAdmin(context);
  await page.goto("/admin/accounts");
  await page
    .getByRole("listitem")
    .filter({ hasText: "test01" })
    .getByRole("button", { name: "この会員として操作" })
    .click();
  const banner = page.getByRole("status").filter({ hasText: "として操作中" });
  await expect(banner).toContainText("テスト一郎");
  await page.goto("/follow");
  await memberRow(page, "太郎")
    .getByRole("button", { name: "フォローする" })
    .click();
  await expect(
    memberRow(page, "太郎").getByRole("button", { name: "フォロー解除" }),
  ).toBeVisible();

  // The row is the member's, stamped in UTC (not shifted to Japan time).
  const rows = await followersOfTaro();
  expect(rows.map((row) => row.followerId)).toEqual([memberOwnerId(test01)]);
  expect(Math.abs(rows[0].ms - Date.now())).toBeLessThan(60_000);

  // Back as the admin, the follow is not the admin's.
  await banner.getByRole("button", { name: "管理者に戻る" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/admin/accounts");
  await page.goto("/follow");
  const taroRow = memberRow(page, "太郎");
  await taroRow.getByRole("button", { name: "フォローする" }).click();
  await expect(
    taroRow.getByRole("button", { name: "フォロー解除" }),
  ).toBeVisible();
  expect((await followersOfTaro()).map((row) => row.followerId).sort()).toEqual(
    [adminOwnerId, memberOwnerId(test01)].sort(),
  );

  // Taro counts the admin among the followers.
  const a = await signedInPage(browser, baseURL, "taro", "/follow");
  try {
    await expect(
      a.page.getByText("フォロー中 0人・フォロワー 2人"),
    ).toBeVisible();
  } finally {
    await a.context.close();
  }
});

test(
  "forged follow targets are refused",
  anyWidth,
  async ({ browser, baseURL, db }) => {
    await createMember(db, "taro", "太郎", password);
    const hanako = await createMember(db, "hanako", "花子", password);

    const b = await signedInPage(browser, baseURL, "hanako", "/follow");
    try {
      const taroRow = memberRow(b.page, "太郎");
      const forge = async (followeeId: string) => {
        await taroRow
          .locator('input[name="followeeId"]')
          .evaluate((input, id) => {
            (input as HTMLInputElement).value = id;
          }, followeeId);
        await taroRow.getByRole("button", { name: "フォローする" }).click();
      };
      const follows = async () =>
        (await db.query(`SELECT count(*)::int AS n FROM "Follow"`)).rows[0].n;

      // A member who does not exist.
      await forge("password:gone00000000000000000000");
      await expect(
        b.page.getByText("見つかりませんでした。画面を更新してください。"),
      ).toBeVisible();
      expect(await follows()).toBe(0);

      // Oneself.
      await forge(memberOwnerId(hanako));
      await expect(
        b.page.getByText("自分はフォローできません。"),
      ).toBeVisible();
      expect(await follows()).toBe(0);
    } finally {
      await b.context.close();
    }
  },
);
