import { readFile } from "node:fs/promises";
import { asAdmin, expect, test } from "./fixtures";
import { baseURL } from "./environment";

test("conversation ends, saves privately, downloads and restores local drafts", async ({
  page,
  context,
  db,
}) => {
  await asAdmin(context);
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body:
        [
          { type: "start", messageId: "assistant-1" },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "你好！" },
          { type: "text-end", id: "text-1" },
          { type: "finish", finishReason: "stop" },
        ]
          .map((value) => `data: ${JSON.stringify(value)}\n\n`)
          .join("") + "data: [DONE]\n\n",
    });
  });
  await page.goto("/chat");
  await page.getByLabel("ChatGPTへのメッセージ").fill("你好");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.getByLabel("ChatGPTのメッセージ")).toContainText("你好！");
  await expect(
    page.getByRole("button", { name: "会話を保存する", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("あなたのメッセージ")).toContainText("你好");
  await expect(page.getByLabel("ChatGPTのメッセージ")).toContainText("你好！");
  // End and navigate within one task, before the debounced backup can run.
  await page.evaluate(() => {
    const end = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("会話を終える"),
    );
    const link = [...document.querySelectorAll("a")].find((anchor) =>
      anchor.textContent?.includes("学習ノートへ"),
    );
    if (!end || !link) throw new Error("Missing conversation controls");
    end.click();
    link.click();
  });
  await expect(page).not.toHaveURL(/\/chat$/);
  await page.goto("/chat");

  await expect(page.getByLabel("ChatGPTへのメッセージ")).toBeDisabled();
  await page
    .getByRole("button", { name: "会話を保存する", exact: true })
    .click();
  await expect(
    page.getByText(
      "DBに会話を保存しました。「会話ノート」から日付ごとに見返せます。",
      { exact: true },
    ),
  ).toBeVisible();
  const rows = await db.query('SELECT * FROM "ChatConversation"');
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0].ownerId).toBe("10001");
  expect(rows.rows[0].ended).toBe(true);
  const snapshot = {
    ...rows.rows[0],
    createdAt: rows.rows[0].createdAt.toISOString(),
    updatedAt: rows.rows[0].updatedAt.toISOString(),
  };
  const again = await context.request.put(`${baseURL}/api/chat/conversations`, {
    headers: { origin: baseURL },
    data: snapshot,
  });
  expect(again.status()).toBe(200);
  expect(
    (await db.query('SELECT count(*) FROM "ChatConversation"')).rows[0].count,
  ).toBe("1");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "端末にダウンロード", exact: true })
    .click();
  const download = await downloadPromise;
  const text = await readFile((await download.path())!, "utf8");
  expect(text).toContain("## あなた");
  expect(text).toContain("## ChatGPT");
  expect(text).toContain("你好！");
  await page.getByRole("button", { name: "新しい会話", exact: true }).click();
  await expect(page.getByLabel("ChatGPTへのメッセージ")).toBeEnabled();
  await expect(page.getByLabel("あなたのメッセージ")).toHaveCount(0);
  await page.evaluate(() =>
    localStorage.removeItem("zhuelog:chat-history:v1:10001"),
  );
  await page.reload();
  await page.getByText(/保存した会話（1件）/).click();
  await page.getByRole("button", { name: /你好.*DB保存済み/ }).click();
  await expect(page.getByLabel("ChatGPTのメッセージ")).toContainText("你好！");
  await expect(page.getByLabel("ChatGPTへのメッセージ")).toBeDisabled();

  // The same saved conversation is browsable by date like learning notes.
  await page.getByRole("link", { name: "会話ノート" }).click();
  await expect(page).toHaveURL(/\/conversations$/);
  await page.getByText("1件の会話ノート").click();
  await page.getByRole("link", { name: /你好/ }).click();
  await expect(page).toHaveURL(/\/conversations\/\d+\/\d+\/\d+\/1$/);
  await expect(page.getByLabel("ChatGPTのメッセージ")).toHaveText("你好！");
  await expect(page.getByText(/終了済み/)).toBeVisible();
  const notePromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "端末にダウンロード", exact: true })
    .click();
  const note = await readFile((await (await notePromise).path())!, "utf8");
  expect(note).toContain("你好！");
});

test("a different owner cannot read or overwrite a conversation", async ({
  context,
  db,
}) => {
  await asAdmin(context);
  const id = "00000000-0000-4000-8000-000000000001";
  await db.query(
    'INSERT INTO "ChatConversation" ("id","ownerId","title","modelName","ended","messages","updatedAt") VALUES ($1,$2,$3,$4,true,$5,NOW())',
    [
      id,
      "20002",
      "private",
      "gpt-6.1-sol",
      JSON.stringify([{ id: "u1", role: "user", text: "secret" }]),
    ],
  );
  const read = await context.request.get(
    `${baseURL}/api/chat/conversations/${id}`,
  );
  expect(read.status()).toBe(404);
  const now = new Date().toISOString();
  const save = await context.request.put(`${baseURL}/api/chat/conversations`, {
    headers: { origin: baseURL },
    data: {
      id,
      title: "hijack",
      modelName: "gpt-6.1-sol",
      ended: true,
      messages: [{ id: "u1", role: "user", text: "hijack" }],
      createdAt: now,
      updatedAt: now,
    },
  });
  expect(save.status()).toBe(403);
  expect(
    (
      await db.query(
        'SELECT "ownerId", "title" FROM "ChatConversation" WHERE "id"=$1',
        [id],
      )
    ).rows[0],
  ).toEqual({ ownerId: "20002", title: "private" });
});

test("ending an in-flight request preserves the prompt and closes the composer", async ({
  page,
  context,
}) => {
  await asAdmin(context);
  let release: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/chat", async (route) => {
    await wait;
    await route.abort().catch(() => {});
  });
  await page.goto("/chat");
  await page.getByLabel("ChatGPTへのメッセージ").fill("終わらせる会話");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.getByText("考えています…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "会話を終える", exact: true }).click();
  await expect(page.getByLabel("ChatGPTへのメッセージ")).toBeDisabled();
  await expect(page.getByLabel("あなたのメッセージ")).toContainText(
    "終わらせる会話",
  );
  release();
  await page.reload();
  await expect(page.getByLabel("あなたのメッセージ")).toContainText(
    "終わらせる会話",
  );
  await expect(page.getByLabel("ChatGPTへのメッセージ")).toBeDisabled();
});

test("failed DB save keeps local recovery and download available", async ({
  page,
  context,
}) => {
  await asAdmin(context);
  const now = new Date().toISOString();
  await page.addInitScript(
    ({ now }) =>
      localStorage.setItem(
        "zhuelog:chat-history:v1:10001",
        JSON.stringify({
          activeId: "00000000-0000-4000-8000-000000000001",
          conversations: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              title: "バックアップ",
              modelName: "gpt-6.1-sol",
              ended: true,
              createdAt: now,
              updatedAt: now,
              messages: [
                { id: "u1", role: "user", text: "保存失敗しても残る" },
              ],
            },
          ],
        }),
      ),
    { now },
  );
  await page.route("**/api/chat/conversations", async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({
        status: 503,
        json: { error: "DBへ保存できませんでした。" },
      });
    else await route.continue();
  });
  await page.goto("/chat");
  await page
    .getByRole("button", { name: "会話を保存する", exact: true })
    .click();
  await expect(
    page.getByText("DBへ保存できませんでした。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "端末にダウンロード", exact: true }),
  ).toBeEnabled();
  const text = await page.evaluate(() =>
    localStorage.getItem("zhuelog:chat-history:v1:10001"),
  );
  expect(text).toContain("保存失敗しても残る");
});
