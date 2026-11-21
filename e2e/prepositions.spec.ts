import type { Page, Request } from "@playwright/test";

import {
  anyWidth,
  asAdmin,
  asGuest,
  asMember,
  createMember,
  expect,
  memberOwnerId,
  practicePrepositionRound,
  test,
} from "./fixtures";

const QUESTION_COUNT = 25;

// Answers every question by picking the choices in order until the right
// one, so the misses depend on where the answers land.
async function answerAll(page: Page) {
  const choices = page.getByRole("group", { name: "介詞を選ぶ" });
  for (let i = 0; i < QUESTION_COUNT; i++) {
    await expect(
      page.getByRole("progressbar", { name: "進捗" }),
    ).toHaveAttribute("aria-valuenow", String(i));
    for (const button of await choices.getByRole("button").all()) {
      await button.click();
      if (await choices.getByRole("button", { name: /（正解）$/ }).count())
        break;
    }
    await page
      .getByRole("button", {
        name: i + 1 < QUESTION_COUNT ? "次へ" : "結果を見る",
      })
      .click();
  }
}

test("a member's round of 25 shows its result, is recorded and can be read again", async ({
  page,
  db,
}) => {
  const accountId = await createMember(db, "taro", "太郎", "member-password-1");
  await asMember(page, "taro", "member-password-1");
  await page.goto("/practice/prepositions");

  const stats = page.locator("dl").first();
  await expect(stats).toContainText("正答率—");
  await expect(stats).toContainText("ミス0回");
  await expect(stats).toContainText("経過時間0:0");

  await answerAll(page);

  await expect(page.getByText(`${QUESTION_COUNT}問 終了！`)).toBeVisible();
  await expect(page.getByText("記録に保存しました。")).toBeVisible();
  const { rows } = await db.query(
    `SELECT "ownerId", "questionCount", "firstTryCount", "missCount", "elapsedMs", "questions"
     FROM "PrepositionPracticeRecord"`,
  );
  expect(rows).toHaveLength(1);
  const [record] = rows;
  expect(record.ownerId).toBe(memberOwnerId(accountId));
  expect(record.questionCount).toBe(QUESTION_COUNT);
  expect(record.elapsedMs).toBeGreaterThan(0);
  for (const question of record.questions)
    expect(question.id).toMatch(/^P\d+$/);
  const accuracy = Math.round((record.firstTryCount / QUESTION_COUNT) * 100);
  const result = page.getByRole("main");
  await expect(result).toContainText(`正答率${accuracy}%`);
  await expect(result).toContainText(`ミス${record.missCount}回`);

  await page.getByRole("link", { name: "過去の記録" }).last().click();
  await expect(page).toHaveURL(
    (url) => url.pathname === "/practice/prepositions/records",
  );
  await page.getByText(`${QUESTION_COUNT}問`, { exact: true }).click();
  await expect(page).toHaveURL((url) =>
    url.pathname.startsWith("/practice/prepositions/records/"),
  );
  await expect(
    page.getByText(`すべての問題（${QUESTION_COUNT}問）`),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    `ミス${record.missCount}回`,
  );
});

// Keeps the Server Action POST that saves the round, to send it again.
function captureSave(page: Page) {
  const saves: Request[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/practice/prepositions" &&
      request.headers()["next-action"]
    )
      saves.push(request);
  });
  return saves;
}

// The client sends the same id again on a retry. The first save wins and its
// misses are queued again: a card answered for later comes forward to now
// with its FSRS state, and a card already due is left alone.
test(
  "a retried save keeps one round and brings a card due later forward",
  anyWidth,
  async ({ page, db }) => {
    test.setTimeout(90_000);
    const accountId = await createMember(
      db,
      "taro",
      "太郎",
      "member-password-1",
    );
    const owner = memberOwnerId(accountId);
    await asMember(page, "taro", "member-password-1");
    const saves = captureSave(page);
    await practicePrepositionRound(page);
    expect(saves).toHaveLength(1);

    const {
      rows: [record],
    } = await db.query(
      `SELECT "id", "createdAt" FROM "PrepositionPracticeRecord" WHERE "ownerId" = $1`,
      [owner],
    );
    const { rows: items } = await db.query(
      `SELECT "id", "due", "updatedAt" FROM "ReviewItem" WHERE "ownerId" = $1 ORDER BY "targetId"`,
      [owner],
    );
    // Picking in order misses whenever the right choice is not the first, so
    // a round of 25 with fewer than two misses does not happen.
    expect(items.length).toBeGreaterThanOrEqual(2);
    const [a, b] = items;
    // A: answered and sent days ahead, as an answer leaves it.
    await db.query(
      `UPDATE "ReviewItem" SET "due" = now() + interval '10 days', "state" = 2, "reps" = 3,
       "stability" = 7.5, "difficulty" = 5, "lastReview" = now() - interval '1 day'
     WHERE "id" = $1`,
      [a.id],
    );

    const before = (await db.query("SELECT now() AS t")).rows[0].t as Date;
    const retry = await page.request.fetch(saves[0]);
    expect(retry.status()).toBe(200);
    expect(await retry.text()).toContain('{"ok":true}');

    const { rows: records } = await db.query(
      `SELECT "id", "createdAt" FROM "PrepositionPracticeRecord"`,
    );
    expect(records).toEqual([{ id: record.id, createdAt: record.createdAt }]);
    const { rows: after } = await db.query(
      `SELECT "id", "due", "updatedAt", "state", "reps", "stability", "difficulty",
       "lastReview" IS NOT NULL AS "reviewed",
       "due" >= date_trunc('milliseconds', $2::timestamptz) AND "due" <= now() AS "now"
     FROM "ReviewItem" WHERE "ownerId" = $1 ORDER BY "targetId"`,
      [owner, before],
    );
    expect(after).toHaveLength(items.length);
    expect(after[0]).toMatchObject({
      id: a.id,
      now: true,
      state: 2,
      reps: 3,
      stability: 7.5,
      difficulty: 5,
      reviewed: true,
    });
    expect(after[1]).toMatchObject({
      id: b.id,
      due: b.due,
      updatedAt: b.updatedAt,
    });
  },
);

// A round id is the browser's; another member sending one already saved gets
// the generic error, and the round stays its owner's.
test(
  "a round id already saved by someone else is not overwritten",
  anyWidth,
  async ({ page, db, browser }) => {
    test.setTimeout(90_000);
    const taro = await createMember(db, "taro", "太郎", "member-password-1");
    const hanako = await createMember(
      db,
      "hanako",
      "花子",
      "member-password-2",
    );
    await asMember(page, "taro", "member-password-1");
    const saves = captureSave(page);
    await practicePrepositionRound(page);
    expect(saves).toHaveLength(1);
    const [save] = saves;
    const {
      rows: [record],
    } = await db.query(`SELECT "id" FROM "PrepositionPracticeRecord"`);

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await asMember(otherPage, "hanako", "member-password-2");
    const headers = save.headers();
    const response = await otherPage.request.post(save.url(), {
      headers: {
        "next-action": headers["next-action"],
        "content-type": headers["content-type"],
        accept: headers["accept"],
      },
      data: save.postData() ?? "",
    });
    expect(await response.text()).toContain(
      "処理できませんでした。時間をおいてもう一度お試しください。",
    );

    const { rows: records } = await db.query(
      `SELECT "id", "ownerId" FROM "PrepositionPracticeRecord"`,
    );
    expect(records).toEqual([{ id: record.id, ownerId: memberOwnerId(taro) }]);
    const { rows: items } = await db.query(
      `SELECT count(*)::int AS n FROM "ReviewItem" WHERE "ownerId" = $1`,
      [memberOwnerId(hanako)],
    );
    expect(items[0].n).toBe(0);
    // The record page streams behind its skeleton (records/layout.tsx), so
    // the status is already 200 when notFound() runs: check the not-found page.
    await otherPage.goto(`/practice/prepositions/records/${record.id}`);
    await expect(
      otherPage.getByText("This page could not be found."),
    ).toBeVisible();
    await expect(otherPage.getByText(/すべての問題/)).toHaveCount(0);
    await other.close();
  },
);

test("an admin's rounds are their own; a guest practices without a record", async ({
  page,
  context,
  db,
  browser,
}) => {
  await asAdmin(context);
  await page.goto("/practice/prepositions/records");
  await expect(page.getByText("まだ練習の記録がありません")).toBeVisible();

  const guest = await browser.newPage();
  await asGuest(guest, "/practice/prepositions");
  await guest.goto("/practice/prepositions");
  await expect(guest.getByRole("link", { name: "過去の記録" })).toHaveCount(0);
  await answerAll(guest);
  await expect(
    guest.getByText("ゲストの練習は記録に残りません。"),
  ).toBeVisible();
  expect((await guest.goto("/practice/prepositions/records"))?.status()).toBe(
    404,
  );
  await guest.close();
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM "PrepositionPracticeRecord"`,
  );
  expect(rows[0].n).toBe(0);
});

test("a solved question shows the example's pinyin above it", async ({
  page,
}) => {
  await asGuest(page);
  await page.goto("/practice/prepositions");
  const choices = page.getByRole("group", { name: "介詞を選ぶ" });
  for (const button of await choices.getByRole("button").all()) {
    await button.click();
    if (await choices.getByRole("button", { name: /（正解）$/ }).count()) break;
  }
  const pinyin = page.locator('[lang="zh-Latn-pinyin"]');
  await expect(pinyin).toHaveText(/^\p{Lu}\S*( \S+)*[.?!”]$/u);
  expect(
    await pinyin.evaluate((el) => el.nextElementSibling?.getAttribute("lang")),
  ).toBe("zh-CN");
});

test("the keys 1 to 4 pick the choices and Enter goes on", async ({ page }) => {
  await asGuest(page, "/practice/prepositions");
  await page.goto("/practice/prepositions");
  await expect(
    page.getByRole("link", { name: "練習をやめる" }),
  ).toHaveAttribute("href", "/practice");
  const choices = page.getByRole("group", { name: "介詞を選ぶ" });
  const buttons = choices.getByRole("button");
  await expect(buttons).toHaveCount(4);
  for (let i = 0; i < 4; i++)
    await expect(buttons.nth(i)).toHaveAttribute(
      "aria-keyshortcuts",
      String(i + 1),
    );
  const first = await choices.innerText();

  for (let key = 1; key <= 4; key++) {
    await page.keyboard.press(String(key));
    if (await choices.getByRole("button", { name: /（正解）$/ }).count()) break;
  }
  await expect(choices.getByRole("button", { name: /（正解）$/ })).toHaveCount(
    1,
  );
  await expect(page.getByRole("progressbar", { name: "進捗" })).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  // Away from "next", so the page's own Enter is what goes on.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "次へ" })).toHaveCount(0);
  await expect(choices.getByRole("button", { name: /（正解）$/ })).toHaveCount(
    0,
  );
  await expect.poll(() => choices.innerText()).not.toBe(first);
});
