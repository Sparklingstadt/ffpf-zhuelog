import type { Browser, Page } from "@playwright/test";
import {
  adminOwnerId,
  asAdmin,
  asGuest,
  asMember,
  createMember,
  expect,
  memberOwnerId,
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
    await expect(taroRow).toContainText("太郎（taro）");
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
    page.getByRole("link", { name: "フォロー", exact: true }),
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
  await page.getByRole("link", { name: "フォロー", exact: true }).click();
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
