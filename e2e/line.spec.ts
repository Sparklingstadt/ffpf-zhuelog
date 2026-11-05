import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  asGuest,
  asMember,
  createMember,
  expect,
  memberOwnerId,
  test,
} from "./fixtures";

test("linked members can unlink and see links completed in LINE without reloading", async ({
  page,
  db,
}) => {
  const id = await createMember(
    db,
    "line-member",
    "連携会員",
    "member-password-1",
  );
  const owner = memberOwnerId(id);
  const lineUser = `U${randomUUID().replaceAll("-", "")}`;
  const link = () =>
    db.query(
      'INSERT INTO "LineLink" ("lineUserId", "ownerId", "role", "createdAt") VALUES ($1, $2, $3, NOW())',
      [lineUser, owner, "member"],
    );
  try {
    await link();
    await asMember(page, "line-member", "member-password-1");
    await page.goto("/account/line");
    const unlink = page.getByRole("button", {
      name: "連携を解除",
      exact: true,
    });
    await expect(unlink).toBeVisible();
    await unlink.click();
    const issue = page.getByRole("button", { name: "連携コードを出す" });
    await expect(issue).toBeVisible();
    expect(
      (await db.query('SELECT 1 FROM "LineLink" WHERE "ownerId"=$1', [owner]))
        .rowCount,
    ).toBe(0);

    await issue.click();
    await expect(page.locator("output")).toBeVisible();
    // Simulate the link completed by LINE's webhook, outside the open page.
    await link();
    await expect(unlink).toBeVisible();
    await expect(page.locator("output")).toHaveCount(0);
    await unlink.click();
    await expect(issue).toBeVisible();
    await expect(page.locator("output")).toHaveCount(0);
  } finally {
    await db.query('DELETE FROM "LineLink" WHERE "ownerId"=$1', [owner]);
    await db.query('DELETE FROM "LineLinkCode" WHERE "ownerId"=$1', [owner]);
  }
});

test("member issues a LINE link code with a matching QR and mobile link", async ({
  page,
  db,
}, testInfo) => {
  await createMember(db, "taro", "太郎", "member-password-1");
  await asMember(page, "taro", "member-password-1");

  await page.getByRole("link", { name: "LINE 連携" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/account/line");
  await expect(
    page.getByRole("heading", { name: "LINE 連携", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("OpenAI（ChatGPT）に送られます")).toBeVisible();

  await page.clock.install();
  await page.getByRole("button", { name: "連携コードを出す" }).click();
  const output = page.locator("output");
  await expect(output).toContainText("まで有効（10分）");
  await expect(output.locator("span").first()).toHaveText(/^[A-Z2-9]{8}$/);
  const firstCode = (await output.locator("span").first().innerText()).trim();
  const openLine = page.getByRole("link", { name: "LINEで開く", exact: true });
  await expect(openLine).toHaveAttribute(
    "href",
    `https://line.me/R/oaMessage/%40393bohaw/?${firstCode}`,
  );
  const qr = page.getByRole("img", { name: "LINE連携用QRコード", exact: true });
  await expect(qr).toBeVisible();

  await page.getByRole("button", { name: "連携コードを出す" }).click();
  await expect(output.locator("span").first()).not.toHaveText(firstCode);
  const code = (await output.locator("span").first().innerText()).trim();
  const expectedUrl = `https://line.me/R/oaMessage/%40393bohaw/?${code}`;
  await expect(openLine).toHaveAttribute("href", expectedUrl);
  await qr.evaluate((node) =>
    node.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await qr.screenshot({ path: testInfo.outputPath("line-link-qr.png") });
  await writeFile(testInfo.outputPath("line-message-url.txt"), expectedUrl);
  await page.screenshot({
    path: testInfo.outputPath("line-link-screen.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await page.clock.fastForward(10 * 60 * 1000 + 1000);
  await expect(qr).toHaveCount(0);
  await expect(openLine).toHaveCount(0);
  await expect(
    page.getByText(/連携コードの有効期限が切れました/),
  ).toBeVisible();
});

test("guest has no LINE link menu and is sent away from the page", async ({
  page,
}) => {
  await asGuest(page);
  await expect(page.getByRole("link", { name: "LINE 連携" })).toHaveCount(0);

  await page.goto("/account/line");
  await expect(page).toHaveURL((url) => url.pathname === "/");
});
