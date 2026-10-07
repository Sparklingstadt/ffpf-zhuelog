import type { Page } from "@playwright/test";
import { baseURL } from "./environment";
import {
  adminOwnerId,
  asAdmin,
  createMember,
  expect,
  memberOwnerId,
  seedConversation,
  seedNotes,
  test,
} from "./fixtures";

// 2026-10-04 in JST, a few minutes apart so the day's numbering is A1, A2, A3.
const day = "2026/10/4";
const notes = [
  { text: "A1原文", createdAt: "2026-10-04T01:00:00Z", hint: "「一」" },
  { text: "A2原文", createdAt: "2026-10-04T02:00:00Z", hint: "「二」" },
  { text: "A3原文", createdAt: "2026-10-04T03:00:00Z", hint: "「三」" },
];

const summaries = (page: Page) => page.locator("details summary");

async function trashFromDetail(page: Page, path: string) {
  await page.goto(path);
  await page.getByRole("button", { name: "ゴミ箱に入れる" }).click();
}

test("a learning note goes to the trash, comes back, and is deleted for good", async ({
  page,
  context,
  db,
}) => {
  await seedNotes(db, adminOwnerId, notes);
  await asAdmin(context);

  // Moving to the trash lands on the day's list with the notice.
  await trashFromDetail(page, `/logs/${day}/2`);
  await expect(page).toHaveURL(`/logs/${day}?trashed=1`);
  await expect(
    page.getByText("ゴミ箱に入れました。ゴミ箱から元に戻せます。"),
  ).toBeVisible();
  await expect(summaries(page)).toHaveCount(2);
  await expect(summaries(page).filter({ hasText: "A2原文" })).toHaveCount(0);
  await expect(page.getByText("この日に追加した学習ノート：2件")).toBeVisible();

  // The remaining notes are numbered again: #2 is now A3, and #3 is gone.
  await page.goto(`/logs/${day}/2`);
  await expect(summaries(page)).toHaveText(/A3原文/);
  expect((await page.goto(`/logs/${day}/3`))?.status()).toBe(404);

  // Nor does it show among the recent notes on the home page.
  await page.goto("/");
  await expect(summaries(page).filter({ hasText: "A1原文" })).toHaveCount(1);
  await expect(summaries(page).filter({ hasText: "A2原文" })).toHaveCount(0);

  // The trash shows it; restoring puts it back as #2.
  await page.goto(`/logs/${day}?trashed=1`);
  await page.getByRole("link", { name: "ゴミ箱を開く" }).click();
  await expect(page).toHaveURL("/logs/trash");
  await expect(page.getByText("ゴミ箱：1件")).toBeVisible();
  await expect(summaries(page)).toHaveCount(1);
  await expect(summaries(page)).toHaveText(/A2原文/);
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("ゴミ箱は空です")).toBeVisible();
  await page.goto(`/logs/${day}/2`);
  await expect(summaries(page)).toHaveText(/A2原文/);

  // Deleting for good asks first; cancelling keeps the note.
  await trashFromDetail(page, `/logs/${day}/2`);
  await page.goto("/logs/trash");
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe(
      "このノートを完全に削除します。元に戻せません。よろしいですか？",
    );
    return dialog.dismiss();
  });
  await page.getByRole("button", { name: "完全に削除" }).click();
  await expect(summaries(page)).toHaveCount(1);
  expect(
    (await db.query('SELECT count(*)::int AS n FROM "LearningEntry"')).rows[0]
      .n,
  ).toBe(3);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "完全に削除" }).click();
  await expect(page.getByText("ゴミ箱は空です")).toBeVisible();
  const remaining = await db.query(
    'SELECT "originalText" FROM "LearningEntry" ORDER BY "createdAt"',
  );
  expect(remaining.rows.map((row) => row.originalText)).toEqual([
    "A1原文",
    "A3原文",
  ]);
  // Its hint went with it.
  expect(
    (await db.query('SELECT content FROM "Hint" ORDER BY content')).rows.map(
      (row) => row.content,
    ),
  ).toEqual(["「一」", "「三」"]);

  // Emptying the trash removes everything in it, after asking.
  await trashFromDetail(page, `/logs/${day}/1`);
  await trashFromDetail(page, `/logs/${day}/1`);
  await expect(page.getByText("この日の学習ノートはありません")).toBeVisible();
  await page.getByRole("link", { name: "ゴミ箱", exact: true }).click();
  await expect(page.getByText("ゴミ箱：2件")).toBeVisible();
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe(
      "ゴミ箱の 2 件を完全に削除します。元に戻せません。よろしいですか？",
    );
    return dialog.accept();
  });
  await page.getByRole("button", { name: "ゴミ箱を空にする" }).click();
  await expect(page.getByText("ゴミ箱は空です")).toBeVisible();
  expect(
    (await db.query('SELECT count(*)::int AS n FROM "LearningEntry"')).rows[0]
      .n,
  ).toBe(0);

  // A day with nothing left disappears from the date list.
  await page.goto("/logs");
  await expect(page.getByText("まだ学習ノートがありません")).toBeVisible();
});

test("a trashed conversation leaves the notes and the chat history until saved again", async ({
  page,
  context,
  db,
}) => {
  await seedConversation(db, 1, adminOwnerId, "2026-10-04T01:00:00Z", "会話1", [
    ["user", "你好"],
    ["assistant", "你好！"],
  ]);
  await seedConversation(db, 2, adminOwnerId, "2026-10-04T02:00:00Z", "会話2", [
    ["user", "谢谢"],
    ["assistant", "不客气"],
  ]);
  const firstId = "00000000-0000-4000-8000-000000000001";
  const saved = (
    await db.query('SELECT * FROM "ChatConversation" WHERE id = $1', [firstId])
  ).rows[0];
  await asAdmin(context);

  await trashFromDetail(page, `/conversations/${day}/1`);
  await expect(page).toHaveURL(`/conversations/${day}?trashed=1`);
  await expect(
    page.getByText("ゴミ箱に入れました。ゴミ箱から元に戻せます。"),
  ).toBeVisible();
  await expect(page.getByText("この日に保存した会話ノート：1件")).toBeVisible();
  await expect(page.getByRole("link", { name: /会話1/ })).toHaveCount(0);

  // The chat page's DB history leaves it out, and so does opening it by id.
  const history = await context.request.get(
    `${baseURL}/api/chat/conversations`,
  );
  expect(
    (await history.json()).map((item: { title: string }) => item.title),
  ).toEqual(["会話2"]);
  expect(
    (
      await context.request.get(`${baseURL}/api/chat/conversations/${firstId}`)
    ).status(),
  ).toBe(404);

  await page.getByRole("link", { name: "ゴミ箱を開く" }).click();
  await expect(page).toHaveURL("/conversations/trash");
  await expect(page.getByText("ゴミ箱：1件")).toBeVisible();
  await expect(page.getByText("会話1")).toBeVisible();
  await expect(page.getByText("2件のメッセージ")).toBeVisible();

  // Saving it again from the chat page takes it back out of the trash.
  const again = await context.request.put(`${baseURL}/api/chat/conversations`, {
    headers: { origin: baseURL },
    data: {
      ...saved,
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
    },
  });
  expect(again.status()).toBe(200);
  await page.reload();
  await expect(page.getByText("ゴミ箱は空です")).toBeVisible();
  await page.goto(`/conversations/${day}`);
  await expect(page.getByText("この日に保存した会話ノート：2件")).toBeVisible();

  // Trash it again and delete it for good.
  await trashFromDetail(page, `/conversations/${day}/1`);
  await page.goto("/conversations/trash");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "完全に削除" }).click();
  await expect(page.getByText("ゴミ箱は空です")).toBeVisible();
  expect(
    (await db.query('SELECT id FROM "ChatConversation"')).rows.map(
      (row) => row.id,
    ),
  ).toEqual(["00000000-0000-4000-8000-000000000002"]);
});

test("an admin viewing someone else can neither trash nor see their trash", async ({
  page,
  context,
  db,
}) => {
  const id = await createMember(db, "taro", "太郎", "member-password-1");
  const member = memberOwnerId(id);
  await seedNotes(db, member, [notes[0], notes[1]]);
  await seedConversation(db, 1, member, "2026-10-04T01:00:00Z", "太郎の会話", [
    ["user", "你好"],
    ["assistant", "你好！"],
  ]);
  // One of the member's notes is already in their trash.
  await db.query(
    `UPDATE "LearningEntry" SET "deletedAt" = NOW() WHERE "originalText" = 'A2原文'`,
  );
  await asAdmin(context);
  const user = `?user=${encodeURIComponent(member)}`;

  await page.goto(`/logs/${day}/1${user}`);
  await expect(
    page.getByText("太郎さんの記録を表示中（閲覧のみ）"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ゴミ箱に入れる" }),
  ).toHaveCount(0);
  await page.goto(`/conversations/${day}/1${user}`);
  await expect(page.getByText("太郎の会話")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ゴミ箱に入れる" }),
  ).toHaveCount(0);
  for (const path of [`/logs${user}`, `/logs/${day}${user}`]) {
    await page.goto(path);
    await expect(
      page.getByText("太郎さんの記録を表示中（閲覧のみ）"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "ゴミ箱", exact: true }),
    ).toHaveCount(0);
  }
  // The member's own trash is not reachable: `?user=` is ignored there.
  await page.goto(`/logs/${day}${user}`);
  await expect(summaries(page)).toHaveCount(1);
  await page.goto(`/logs/trash${user}`);
  await expect(page.getByText("ゴミ箱は空です")).toBeVisible();
  await expect(page.getByText("A2原文")).toHaveCount(0);
});

test("trash pages and buttons fit a narrow phone screen", async ({
  page,
  context,
  db,
}) => {
  await seedNotes(db, adminOwnerId, [notes[0], notes[1]]);
  await seedConversation(db, 1, adminOwnerId, "2026-10-04T01:00:00Z", "会話1", [
    ["user", "你好"],
    ["assistant", "你好！"],
  ]);
  await seedConversation(db, 2, adminOwnerId, "2026-10-04T02:00:00Z", "会話2", [
    ["user", "谢谢"],
    ["assistant", "不客气"],
  ]);
  await asAdmin(context);
  await trashFromDetail(page, `/logs/${day}/1`);
  await trashFromDetail(page, `/conversations/${day}/1`);
  await page.setViewportSize({ width: 320, height: 800 });
  for (const path of [
    "/logs",
    `/logs/${day}?trashed=1`,
    `/logs/${day}/1`,
    "/logs/trash",
    "/conversations",
    `/conversations/${day}?trashed=1`,
    `/conversations/${day}/1`,
    "/conversations/trash",
  ]) {
    await page.goto(path);
    const scrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(scrolls, path).toBe(false);
  }
});
