import { randomUUID } from "node:crypto";

import {
  anyWidth,
  asGuest,
  asMember,
  createMember,
  expect,
  memberOwnerId,
  seedNotes,
  test,
} from "./fixtures";

// Today in Japan, as the page counts it.
function todayInJapan() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test("what a member does today shows on the study log calendar", async ({
  page,
  db,
}) => {
  await createMember(db, "taro", "太郎", "member-password-1");
  await asMember(page, "taro", "member-password-1");

  await page.goto("/vocabulary");
  await page.getByLabel("語句").fill("认真");
  await page.getByLabel("意味").fill("まじめに");
  await page.getByRole("button", { name: "単語帳に入れる" }).click();
  await expect(page.getByText("「认真」を単語帳に入れました。")).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "学習ログ" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/study-log");

  const today = todayInJapan();
  const [year, month] = today.split("-").map(Number);
  await expect(
    page.getByRole("heading", { name: `${year}年${month}月` }),
  ).toBeVisible();
  const totals = page.getByLabel("この月の合計");
  await expect(totals).toContainText("学習した日1日");
  await expect(totals).toContainText("単語1語");
  await expect(page.locator(`[data-date="${today}"]`).first()).toHaveAttribute(
    "data-total",
    "1",
  );
  await expect(
    page.getByRole("gridcell", { name: `${today}：単語1語` }),
  ).toBeVisible();

  // The month before has nothing yet, and offers the way back.
  await page.getByRole("link", { name: "前の月" }).click();
  await expect(totals).toContainText("学習した日0日");
  await page.getByRole("link", { name: "次の月" }).click();
  await expect(totals).toContainText("単語1語");
  await expect(page.getByRole("link", { name: "次の月" })).toHaveCount(0);
});

// Times are UTC (the fixture sets the session time zone); Japan is 9 hours
// ahead, so 15:00 UTC is the start of the next Japan day.
test("the study log counts each kind by Japan day, the owner's only", async ({
  page,
  db,
}) => {
  const taro = memberOwnerId(
    await createMember(db, "taro", "太郎", "member-password-1"),
  );
  const jiro = memberOwnerId(
    await createMember(db, "jiro", "次郎", "member-password-1"),
  );

  await seedNotes(db, taro, [
    { text: "十月的最后一刻。", createdAt: "2026-10-31 14:59:59.999" },
    { text: "十一月的第一刻。", createdAt: "2026-10-31 15:00:00" },
    { text: "扔掉的笔记。", createdAt: "2026-10-31 15:00:00" },
  ]);
  await db.query(
    `UPDATE "LearningEntry" SET "deletedAt" = '2026-11-01 00:00:00'
      WHERE "userId" = $1 AND "originalText" = '扔掉的笔记。'`,
    [taro],
  );
  await db.query(
    `INSERT INTO "PrepositionPracticeRecord"
       (id, "userId", "questionCount", "firstTryCount", "missCount", "elapsedMs", questions, "startedAt", "createdAt")
     VALUES ($1, $2, 3, 3, 0, 1000, '[]', '2026-10-31 15:30:00', '2026-10-31 15:30:00')`,
    [randomUUID(), taro],
  );
  await db.query(
    `INSERT INTO "ComplementPracticeRecord"
       (id, "userId", mode, "questionCount", "firstTryCount", "missCount", "elapsedMs", questions, "startedAt", "createdAt")
     VALUES ($1, $2, 'result', 2, 2, 0, 1000, '[]', '2026-11-01 16:00:00', '2026-11-01 16:00:00')`,
    [randomUUID(), taro],
  );
  const wordId = randomUUID();
  await db.query(
    `INSERT INTO "VocabularyEntry"
       (id, "userId", language, word, pinyin, meaning, "createdAt", "updatedAt")
     VALUES ($1, $2, 'zh', '认真', 'rènzhēn', 'まじめに', '2026-11-01 15:00:00', '2026-11-01 15:00:00')`,
    [wordId, taro],
  );
  const itemId = randomUUID();
  await db.query(
    `INSERT INTO "ReviewItem" (id, "userId", language, kind, "targetId", due, "updatedAt")
     VALUES ($1, $2, 'zh', 'vocabulary', $3, '2026-11-01 15:00:00', '2026-11-01 15:00:00')`,
    [itemId, taro, wordId],
  );
  await db.query(
    `INSERT INTO "ReviewLog"
       (id, "userId", "itemId", rating, state, due, stability, difficulty, "scheduledDays", "reviewedAt")
     VALUES ($1, $2, $3, 3, 0, '2026-11-01 15:00:00', 0, 0, 0, '2026-11-01 15:00:00')`,
    [randomUUID(), taro, itemId],
  );
  // Another member's notes on the same day count for them only.
  await seedNotes(
    db,
    jiro,
    ["一", "二", "三"].map((n) => ({
      text: `次郎的笔记${n}。`,
      createdAt: "2026-10-31 15:00:00",
    })),
  );

  await asMember(page, "taro", "member-password-1");
  const totals = page.getByLabel("この月の合計");

  await page.goto("/study-log?month=2026-10");
  await expect(totals).toContainText("学習した日1日");
  await expect(totals).toContainText("ノート1件");
  await expect(
    page.getByRole("gridcell", { name: "2026-10-31：ノート1件" }).first(),
  ).toBeVisible();

  await page.goto("/study-log?month=2026-11");
  for (const text of [
    "学習した日2日",
    "復習1回",
    "練習5問",
    "ノート1件",
    "単語1語",
  ])
    await expect(totals).toContainText(text);
  await expect(
    page.getByRole("gridcell", { name: "2026-11-01：練習3問・ノート1件" }),
  ).toBeVisible();
  await expect(
    page.getByRole("gridcell", {
      name: "2026-11-02：復習1回・練習2問・単語1語",
    }),
  ).toBeVisible();
  await expect(
    page.locator('[data-date="2026-11-03"]').first(),
  ).toHaveAttribute("data-total", "0");
});

test("guests have no study log", anyWidth, async ({ page }) => {
  await asGuest(page);
  await page.goto("/study-log");
  await expect(page).toHaveURL((url) => url.pathname === "/");
});
