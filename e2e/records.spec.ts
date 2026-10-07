import type { Browser, Page } from "@playwright/test";
import {
  adminOwnerId,
  asAdmin,
  asMember,
  createMember,
  expect,
  memberOwnerId,
  seedConversation,
  seedNotes,
  test,
  upload,
} from "./fixtures";

// A member signs in through the real form in a context of their own, so two
// members (or a member and the admin) can be driven at the same time.
async function openAs(
  browser: Browser,
  baseURL: string | undefined,
  loginId: string,
  password: string,
) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await asMember(page, loginId, password);
  return { context, page };
}

const noteTexts = (page: Page) => page.locator("details summary");

test("members see only their own notes, numbered from 1 for each", async ({
  browser,
  baseURL,
  db,
}) => {
  const idA = await createMember(db, "taro", "太郎", "member-password-1");
  const idB = await createMember(db, "hanako", "花子", "member-password-2");
  const a = await openAs(browser, baseURL, "taro", "member-password-1");
  const b = await openAs(browser, baseURL, "hanako", "member-password-2");
  try {
    await upload(a.page, "A原文1,A添削1,pinyin\nA原文2,A添削2,pinyin", "a.csv");
    await expect(a.page.getByText("2件の学習文を登録しました。")).toBeVisible();
    await upload(b.page, "B原文1,B添削1,pinyin", "b.csv");
    await expect(b.page.getByText("1件の学習文を登録しました。")).toBeVisible();

    // Imports land in the signed-in member's own notes.
    expect(
      (
        await db.query(
          'SELECT "ownerId", count(*)::int AS n FROM "LearningEntry" GROUP BY "ownerId" ORDER BY n DESC',
        )
      ).rows,
    ).toEqual([
      { ownerId: memberOwnerId(idA), n: 2 },
      { ownerId: memberOwnerId(idB), n: 1 },
    ]);

    await a.page.goto("/");
    await expect(noteTexts(a.page)).toHaveCount(2);
    await expect(a.page.getByText("#2", { exact: true })).toBeVisible();
    await expect(a.page.getByText("#1", { exact: true })).toBeVisible();
    await expect(a.page.getByText("A添削1", { exact: true })).toBeVisible();
    await expect(a.page.getByText("B添削1")).toHaveCount(0);

    await b.page.goto("/");
    await expect(noteTexts(b.page)).toHaveCount(1);
    await expect(b.page.getByText("#1", { exact: true })).toBeVisible();
    await expect(b.page.getByText("#2", { exact: true })).toHaveCount(0);
    await expect(b.page.getByText("B添削1", { exact: true })).toBeVisible();
    await expect(b.page.getByText("A添削1")).toHaveCount(0);

    // The date pages count per owner too: A has notes 1 and 2, B only note 1.
    const dateHref = await a.page
      .getByRole("link", { name: "この日の一覧" })
      .first()
      .getAttribute("href");
    expect(dateHref).toBeTruthy();
    // A's /1 and /2 are two different notes, each alone on its page.
    const shown: string[] = [];
    for (const [n, other] of [
      [1, "A添削2"],
      [2, "A添削1"],
    ] as const) {
      expect((await a.page.goto(`${dateHref}/${n}`))?.status()).toBe(200);
      const text = await a.page
        .getByText(/^A添削[12]$/)
        .first()
        .textContent();
      expect(text).toBeTruthy();
      shown.push(text!);
      await expect(a.page.getByText(other, { exact: true })).toHaveCount(0);
      await expect(a.page.getByText("B添削1")).toHaveCount(0);
    }
    expect(new Set(shown).size).toBe(2);
    // B's own count on the date list is 1, not A's 2.
    await b.page.goto("/logs");
    await expect(b.page.getByText("1件の学習ノート")).toBeVisible();
    await expect(b.page.getByText("2件の学習ノート")).toHaveCount(0);
    await b.page.goto(`${dateHref}/1`);
    await expect(b.page.getByText("B添削1", { exact: true })).toBeVisible();
    await expect(b.page.getByText(/A添削/)).toHaveCount(0);
    expect((await b.page.goto(`${dateHref}/2`))?.status()).toBe(404);
    await b.page.goto(dateHref!);
    await expect(noteTexts(b.page)).toHaveCount(1);
    await expect(b.page.getByText(/A添削/)).toHaveCount(0);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("admin views a member's notes read-only and keeps the choice while navigating", async ({
  context,
  page,
  db,
}) => {
  const id = await createMember(db, "taro", "太郎", "member-password-1");
  const ownerId = memberOwnerId(id);
  await seedNotes(db, adminOwnerId, [{ text: "管理者の記録" }]);
  await seedNotes(db, ownerId, [
    { text: "太郎の記録1", createdAt: "2026-09-20T01:00:00Z" },
    { text: "太郎の記録2", createdAt: "2026-09-20T02:00:00Z" },
  ]);
  await asAdmin(context);

  await page.goto("/");
  await expect(
    page.getByText("管理者の記録", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByLabel("CSVファイル", { exact: true })).toBeEnabled();
  await page
    .getByLabel("表示するユーザー")
    .selectOption({ label: "太郎（taro）" });
  await page.getByRole("button", { name: "表示", exact: true }).click();

  await expect(page).toHaveURL(
    (url) => url.pathname === "/" && url.searchParams.get("user") === ownerId,
  );
  await expect(
    page.getByText("太郎さんの記録を表示中（閲覧のみ）"),
  ).toBeVisible();
  await expect(
    page.getByText("太郎の記録1", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("太郎の記録2", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("管理者の記録")).toHaveCount(0);
  await expect(page.getByLabel("CSVファイル", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "CSVをインポート", exact: true }),
  ).toHaveCount(0);

  // Following the links keeps showing the member's notes.
  await page.getByRole("link", { name: "日付から見る" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/logs" && url.searchParams.get("user") === ownerId,
  );
  await page.getByRole("link", { name: /2026\/9\/20/ }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/logs/2026/9/20" &&
      url.searchParams.get("user") === ownerId,
  );
  await expect(
    page.getByText("太郎さんの記録を表示中（閲覧のみ）"),
  ).toBeVisible();
  await expect(noteTexts(page)).toHaveCount(2);
  await page.getByRole("link", { name: "詳細を開く" }).first().click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/logs/2026/9/20/1" &&
      url.searchParams.get("user") === ownerId,
  );
  await expect(
    page.getByText("太郎の記録1", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "次のノート" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/logs/2026/9/20/2" &&
      url.searchParams.get("user") === ownerId,
  );
  await expect(
    page.getByText("太郎の記録2", { exact: true }).first(),
  ).toBeVisible();

  // The banner leads back to the admin's own notes, without `?user`.
  await page.getByRole("link", { name: "自分の記録に戻る" }).click();
  await expect(page).toHaveURL(
    (url) => url.search === "" && url.pathname.startsWith("/logs/2026/9/20"),
  );
  await page.goto("/");
  await expect(
    page.getByText("管理者の記録", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("太郎の記録1")).toHaveCount(0);
});

test("a member cannot view others' records", async ({
  browser,
  baseURL,
  db,
}) => {
  const id = await createMember(db, "taro", "太郎", "member-password-1");
  await seedNotes(db, memberOwnerId(id), [{ text: "太郎の記録" }]);
  await seedNotes(db, adminOwnerId, [{ text: "管理者の記録" }]);
  await seedConversation(
    db,
    1,
    adminOwnerId,
    "2026-10-04T02:00:00Z",
    "管理者会話",
    [
      ["user", "秘密"],
      ["assistant", "了解"],
    ],
  );
  await seedConversation(
    db,
    2,
    memberOwnerId(id),
    "2026-10-04T03:00:00Z",
    "太郎会話",
    [
      ["user", "你好"],
      ["assistant", "你好！"],
    ],
  );
  const member = await openAs(browser, baseURL, "taro", "member-password-1");
  try {
    const { page } = member;
    const other = encodeURIComponent(adminOwnerId);

    await page.goto(`/?user=${other}`);
    await expect(page).toHaveURL(
      (url) => url.pathname === "/" && url.search === "",
    );
    await expect(
      page.getByText("太郎の記録", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("管理者の記録")).toHaveCount(0);
    // Members get neither the switcher nor the viewing banner.
    await expect(page.getByLabel("表示するユーザー")).toHaveCount(0);

    await page.goto(`/logs?user=${other}`);
    await expect(page).toHaveURL(
      (url) => url.pathname === "/logs" && url.search === "",
    );
    await page.goto(`/logs/2026/9/20?user=${other}`);
    await expect(page).toHaveURL(
      (url) => url.pathname === "/logs/2026/9/20" && url.search === "",
    );
    // Not even an unknown owner changes the answer.
    await page.goto("/?user=password%3Anobody");
    await expect(page).toHaveURL(
      (url) => url.pathname === "/" && url.search === "",
    );

    await page.goto(`/conversations?user=${other}`);
    await expect(page).toHaveURL(
      (url) => url.pathname === "/conversations" && url.search === "",
    );
    await expect(page.getByText("1件の会話ノート")).toBeVisible();
    await page.goto(`/conversations/2026/10/4?user=${other}`);
    await expect(page).toHaveURL(
      (url) => url.pathname === "/conversations/2026/10/4" && url.search === "",
    );
    await expect(page.getByText("太郎会話")).toBeVisible();
    await expect(page.getByText("管理者会話")).toHaveCount(0);

    // The export never falls back to the caller's own notes.
    const denied = await page.request.get(
      `/api/integrations/typle/export?user=${other}`,
    );
    expect(denied.status()).toBe(403);
  } finally {
    await member.context.close();
  }
});

test("admin views a member's conversations read-only", async ({
  context,
  page,
  db,
}) => {
  const id = await createMember(db, "taro", "太郎", "member-password-1");
  const ownerId = memberOwnerId(id);
  await seedConversation(
    db,
    1,
    adminOwnerId,
    "2026-10-04T02:00:00Z",
    "管理者会話",
    [
      ["user", "你好"],
      ["assistant", "你好！"],
    ],
  );
  await seedConversation(db, 2, ownerId, "2026-10-04T03:00:00Z", "太郎会話", [
    ["user", "天气"],
    ["assistant", "今天天气很好。"],
  ]);
  await asAdmin(context);

  await page.goto("/conversations");
  await expect(page.getByText("1件の会話ノート")).toBeVisible();
  await page
    .getByLabel("表示するユーザー")
    .selectOption({ label: "太郎（taro）" });
  await page.getByRole("button", { name: "表示", exact: true }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/conversations" &&
      url.searchParams.get("user") === ownerId,
  );
  await expect(
    page.getByText("太郎さんの記録を表示中（閲覧のみ）"),
  ).toBeVisible();

  await page.getByRole("link", { name: /2026\/10\/4/ }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/conversations/2026/10/4" &&
      url.searchParams.get("user") === ownerId,
  );
  await expect(page.getByText("太郎会話")).toBeVisible();
  await expect(page.getByText("管理者会話")).toHaveCount(0);
  await page.getByRole("link", { name: /太郎会話/ }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/conversations/2026/10/4/1" &&
      url.searchParams.get("user") === ownerId,
  );
  await expect(
    page.getByRole("article", { name: "ChatGPTのメッセージ" }),
  ).toHaveText("今天天气很好。");
  await expect(
    page.getByText("太郎さんの記録を表示中（閲覧のみ）"),
  ).toBeVisible();
});

test("the export contains only the shown owner's notes", async ({
  browser,
  baseURL,
  context,
  page,
  db,
}) => {
  const id = await createMember(db, "taro", "太郎", "member-password-1");
  const ownerId = memberOwnerId(id);
  await seedNotes(db, adminOwnerId, [
    { text: "管理者の文", hint: "料理を数える量詞は「道」" },
  ]);
  await seedNotes(db, ownerId, [
    { text: "太郎の文", hint: "山を表す字は「山」" },
  ]);
  const words = async (response: {
    status(): number;
    json(): Promise<{ lists: { words: { display: string }[] }[] }>;
  }) => {
    expect(response.status()).toBe(200);
    return (await response.json()).lists[0].words.map((w) => w.display);
  };
  await asAdmin(context);

  expect(
    await words(await page.request.get("/api/integrations/typle/export")),
  ).toEqual(["道"]);
  expect(
    await words(
      await page.request.get(
        `/api/integrations/typle/export?user=${encodeURIComponent(ownerId)}`,
      ),
    ),
  ).toEqual(["山"]);

  // The preview page and its download link follow the shown owner.
  await page.goto(`/integrations/typle?user=${encodeURIComponent(ownerId)}`);
  await expect(page.getByText("山", { exact: true })).toBeVisible();
  await expect(page.getByText("道", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Typle互換JSONをダウンロード" }),
  ).toHaveAttribute("href", /user=password%3A/);

  const member = await openAs(browser, baseURL, "taro", "member-password-1");
  try {
    expect(
      await words(
        await member.page.request.get("/api/integrations/typle/export"),
      ),
    ).toEqual(["山"]);
    expect(
      (
        await member.page.request.get(
          `/api/integrations/typle/export?user=${encodeURIComponent(adminOwnerId)}`,
        )
      ).status(),
    ).toBe(403);
  } finally {
    await member.context.close();
  }
});

test("an admin with a malformed ?user= sees their own notes, and a raw owner ID shows as is", async ({
  context,
  page,
  db,
}) => {
  await seedNotes(db, adminOwnerId, [{ text: "管理者の記録" }]);
  await asAdmin(context);

  await page.goto("/?user=../x");
  await expect(page).toHaveURL(
    (url) => url.pathname === "/" && url.search === "",
  );
  await expect(
    page.getByText("管理者の記録", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("さんの記録を表示中")).toHaveCount(0);

  // A well-formed ID that no member has still shows, named by the raw ID.
  await page.goto("/?user=999999");
  await expect(page).toHaveURL(
    (url) => url.pathname === "/" && url.searchParams.get("user") === "999999",
  );
  await expect(
    page.getByText("999999さんの記録を表示中（閲覧のみ）"),
  ).toBeVisible();
  await expect(page.getByText("管理者の記録")).toHaveCount(0);

  // Choosing 「自分」 in the switcher goes back to the bare path.
  await page.getByLabel("表示するユーザー").selectOption({ label: "自分" });
  await page.getByRole("button", { name: "表示", exact: true }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === "/" && url.search === "",
  );
  await expect(
    page.getByText("管理者の記録", { exact: true }).first(),
  ).toBeVisible();
});
