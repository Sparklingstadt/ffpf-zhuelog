import {
  addAdminSession,
  asAdmin,
  asGuest,
  expect,
  test,
  upload,
} from "./fixtures";
import { baseURL, cookieName } from "./environment";

test("nonce CSP is active, rotates, blocks injected scripts and retains working hydration", async ({
  page,
}) => {
  const first = await page.goto("/signin");
  const policy = first?.headers()["content-security-policy"] ?? "";
  expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(policy).not.toContain("unsafe-eval");
  expect(first?.headers()["x-powered-by"]).toBeUndefined();
  expect(first?.headers()["x-content-type-options"]).toBe("nosniff");
  const second = await page.reload();
  expect(second?.headers()["content-security-policy"]).not.toBe(policy);
  // Parser-inserted malicious markup, not a trusted DevTools evaluation.
  await page.route("**/signin", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      "</head>",
      "<script>document.documentElement.dataset.injected='yes'</script></head>",
    );
    await route.fulfill({ response, body });
  });
  await page.reload();
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-injected",
    "yes",
  );
  await page.getByRole("button", { name: "ゲストとして使う" }).click();
  await expect(page.getByText("ゲスト", { exact: true })).toBeVisible();
});

test("revoked admin JWT cannot access pages or import actions", async ({
  context,
  page,
  db,
}) => {
  await asAdmin(context);
  await page.goto("/import");
  await page.waitForLoadState("networkidle");
  // Validly signed, but for an admin who is not on the allowlist.
  await addAdminSession(context, { githubId: "removed", login: "removed" });
  await upload(page, "原文,添削,pinyin");
  await expect(
    page.getByText(
      "この操作を行う権限がありません。再度ログインしてください。",
    ),
  ).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin/);
  expect(
    (await db.query('SELECT count(*)::int AS n FROM "ImportBatch"')).rows[0].n,
  ).toBe(0);
});

test("stored CSV markup renders as text and huge log ordinals return 404", async ({
  page,
  context,
}) => {
  await asAdmin(context);
  await upload(
    page,
    "<script>document.documentElement.dataset.injected='yes'</script>,添削,pinyin,<img src=x onerror=alert(1)>",
  );
  await expect(page.getByText("1件の学習文を登録しました。")).toBeVisible();
  await page.goto("/");
  await expect(page.locator("details script, details img")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-injected",
    "yes",
  );
  await expect(
    page.getByText("<img src=x onerror=alert(1)>", { exact: true }),
  ).toBeVisible();
  expect((await page.goto("/logs/2026/9/24/9007199254740991"))?.status()).toBe(
    404,
  );
});

test("encoded external callback is rejected and guest session cookie is HttpOnly", async ({
  page,
  context,
}) => {
  await asGuest(page, "/%5cevil.example");
  await expect(page).toHaveURL(`${baseURL}/`);
  const cookie = (await context.cookies()).find(
    (entry) => entry.name === cookieName,
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
});
