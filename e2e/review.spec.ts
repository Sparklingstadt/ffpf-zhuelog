import {
  anyWidth,
  asGuest,
  asMember,
  createMember,
  expect,
  memberOwnerId,
  pickUntilRight,
  practicePrepositionRound,
  test,
} from "./fixtures";

const QUESTION_COUNT = 25;
// How many due items /review shows at once (SESSION_SIZE in its page).
const REVIEW_SESSION_SIZE = 20;

test("missed practice questions come back on the review page and an answer reschedules them", async ({
  page,
  db,
}) => {
  const accountId = await createMember(db, "taro", "太郎", "member-password-1");
  const owner = memberOwnerId(accountId);
  await asMember(page, "taro", "member-password-1");

  await page.goto("/");
  await expect(page.getByTestId("review-due-count")).toHaveText("0");
  await expect(page.getByTestId("review-streak-days")).toHaveText("0");
  // The card names every kind of review, notes included.
  await expect(
    page.getByText(
      "練習で間違えた問題、単語帳の語句、復習に入れた学習ノートがここに入ります。",
      { exact: false },
    ),
  ).toBeVisible();

  await practicePrepositionRound(page);
  const {
    rows: [round],
  } = await db.query(
    `SELECT "questions" FROM "PrepositionPracticeRecord" WHERE "userId" = $1`,
    [owner],
  );
  const missed = (
    round.questions as { id: string; noun: string; misses: string[] }[]
  ).filter((q) => q.misses.length > 0);
  // Picking in order misses whenever the right choice is not the first, so
  // a round of 25 without a miss does not happen.
  expect(missed.length).toBeGreaterThan(0);

  const { rows: items } = await db.query(
    `SELECT "kind", "targetId", "language", "state" FROM "ReviewItem" WHERE "userId" = $1 ORDER BY "targetId"`,
    [owner],
  );
  expect(items.map((it) => it.targetId)).toEqual(
    missed.map((q) => `${q.id}:${q.noun}`).sort(),
  );
  for (const it of items) {
    expect(it.kind).toBe("preposition");
    expect(it.language).toBe("zh");
    expect(it.state).toBe(0);
  }

  await page.goto("/");
  await expect(page.getByTestId("review-due-count")).toHaveText(
    String(missed.length),
  );
  await page.getByRole("link", { name: "復習する" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/review");
  // A round with many misses shows only the first session's worth.
  const shown = Math.min(missed.length, REVIEW_SESSION_SIZE);
  await expect(page.getByText(`1 / ${shown}`)).toBeVisible();

  await pickUntilRight(page, "選択肢");
  // As in the practice, the example comes with its pinyin above it.
  const pinyin = page.locator('[lang="zh-Latn-pinyin"]');
  await expect(pinyin).toHaveText(/^\p{Lu}\S*( \S+)*[.?!”]$/u);
  expect(
    await pinyin.evaluate((el) => el.nextElementSibling?.getAttribute("lang")),
  ).toBe("zh-CN");
  await page
    .getByRole("group", { name: "思い出せた度合い" })
    .getByRole("button", { name: "簡単" })
    .click();
  if (shown > 1) await expect(page.getByText(`2 / ${shown}`)).toBeVisible();
  else await expect(page.getByText("1問 復習しました")).toBeVisible();

  const { rows: logs } = await db.query(
    `SELECT l."rating", l."state", i."reps", i."due" > now() AS "later"
     FROM "ReviewLog" l JOIN "ReviewItem" i ON i."id" = l."itemId" WHERE l."userId" = $1`,
    [owner],
  );
  expect(logs).toEqual([{ rating: 4, state: 0, reps: 1, later: true }]);

  await page.goto("/");
  await expect(page.getByTestId("review-due-count")).toHaveText(
    String(missed.length - 1),
  );
  await expect(page.getByTestId("review-streak-days")).toHaveText("1");
});

// The verb mode of the complement practice reviews like the prepositions:
// each missed question comes back by its CSV row and verb, shown large.
test("missed verb-mode complement questions come back on the review page like prepositions", async ({
  page,
  db,
}) => {
  test.setTimeout(60_000);
  const accountId = await createMember(db, "taro", "太郎", "member-password-1");
  const owner = memberOwnerId(accountId);
  await asMember(page, "taro", "member-password-1");

  await page.goto("/practice/complements/verb");
  for (let i = 0; i < QUESTION_COUNT; i++) {
    await expect(
      page.getByRole("progressbar", { name: "進捗" }),
    ).toHaveAttribute("aria-valuenow", String(i));
    await pickUntilRight(page, "補語を選ぶ");
    await page
      .getByRole("button", {
        name: i + 1 < QUESTION_COUNT ? "次へ" : "結果を見る",
      })
      .click();
  }
  await expect(page.getByText("記録に保存しました。")).toBeVisible();
  const {
    rows: [round],
  } = await db.query(
    `SELECT "questions" FROM "ComplementPracticeRecord" WHERE "userId" = $1`,
    [owner],
  );
  const missed = (
    round.questions as { id: string; noun: string; misses: string[] }[]
  ).filter((q) => q.misses.length > 0);
  // Picking in order misses whenever the right choice is not the first, so
  // a round of 25 without a miss does not happen.
  expect(missed.length).toBeGreaterThan(0);

  const { rows: items } = await db.query(
    `SELECT "kind", "targetId" FROM "ReviewItem" WHERE "userId" = $1 ORDER BY "targetId"`,
    [owner],
  );
  expect(items.map((it) => it.targetId)).toEqual(
    missed.map((q) => q.id).sort(),
  );
  for (const it of items) expect(it.kind).toBe("complement");
  for (const q of missed) expect(q.id).toMatch(/^verb:C\d{3}:.+$/);

  await page.goto("/review");
  const shown = Math.min(missed.length, REVIEW_SESSION_SIZE);
  await expect(page.getByText(`1 / ${shown}`)).toBeVisible();
  // The card looks like a preposition one: a 補語 badge and the verb large.
  const card = page.getByRole("main");
  await expect(card.getByText("補語", { exact: true })).toBeVisible();
  const verbs = missed.map((q) => q.noun);
  const heading = card.locator("p.text-6xl").first();
  await expect(heading).toBeVisible();
  expect(verbs).toContain(await heading.innerText());

  await pickUntilRight(page, "選択肢");
  await page
    .getByRole("group", { name: "思い出せた度合い" })
    .getByRole("button", { name: "簡単" })
    .click();
  // The next card (or the end) means the answer has been saved.
  if (shown > 1) await expect(page.getByText(`2 / ${shown}`)).toBeVisible();
  else await expect(page.getByText("1問 復習しました")).toBeVisible();
  const { rows: logs } = await db.query(
    `SELECT l."rating" FROM "ReviewLog" l WHERE l."userId" = $1`,
    [owner],
  );
  expect(logs).toEqual([{ rating: 4 }]);
});

// Saving a word refreshes the page's data, and the due list no longer has
// the cards already answered. The open session must stay on its own card,
// unanswered cards included, rather than slide to the next one as solved.
test("adding a word from a solved card leaves the session where it was", async ({
  page,
  db,
}) => {
  const accountId = await createMember(db, "taro", "太郎", "member-password-1");
  const owner = memberOwnerId(accountId);
  const prompts = [
    "我听（　）了老师的解释。",
    "我终于找（　）钥匙了。",
    "今天的作业已经做（　）了。",
  ];
  for (const [i, targetId] of ["result-01", "result-02", "result-03"].entries())
    await db.query(
      `INSERT INTO "ReviewItem"
       ("id", "userId", "language", "kind", "targetId", "due", "state", "createdAt", "updatedAt")
       VALUES ('c' || substr(md5(random()::text), 1, 24), $1, 'zh', 'complement', $2,
               now() - make_interval(mins => $3), 0, now(), now())`,
      [owner, targetId, 10 - i],
    );
  await asMember(page, "taro", "member-password-1");

  await page.goto("/review");
  const ratings = page.getByRole("group", { name: "思い出せた度合い" });
  await expect(page.getByText("1 / 3")).toBeVisible();
  await expect(page.getByText(prompts[0])).toBeVisible();
  await pickUntilRight(page, "選択肢");
  await ratings.getByRole("button", { name: "簡単" }).click();

  await expect(page.getByText("2 / 3")).toBeVisible();
  await expect(page.getByText(prompts[1])).toBeVisible();
  await pickUntilRight(page, "選択肢");
  await page.getByText("例文の語句を単語帳に入れる").click();
  await page.getByRole("textbox", { name: "語句" }).fill("钥匙");
  await page.getByRole("textbox", { name: "ピンイン" }).fill("yàoshi");
  await page.getByRole("textbox", { name: "意味" }).fill("鍵");
  await page.getByRole("button", { name: "単語帳に入れる" }).click();
  await expect(page.getByText("「钥匙」を単語帳に入れました。")).toBeVisible();

  // Still the second card, solved; the third has not been touched.
  await expect(page.getByText("2 / 3")).toBeVisible();
  await expect(page.getByText(prompts[1])).toBeVisible();
  await expect(page.getByText(prompts[2])).toHaveCount(0);
  await ratings.getByRole("button", { name: "できた" }).click();

  await expect(page.getByText("3 / 3")).toBeVisible();
  await expect(page.getByText(prompts[2])).toBeVisible();
  await expect(ratings).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "選択肢" }).getByRole("button", {
      name: /（正解）$/,
    }),
  ).toHaveCount(0);
});

test("guests have no review queue", anyWidth, async ({ page }) => {
  await asGuest(page);
  await page.goto("/review");
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.getByTestId("review-due-count")).toHaveCount(0);
});
