import type { Page } from "@playwright/test";
import { asAdmin, expect, test, upload } from "./fixtures";

const storageKey = "zhuelog:theme:v1";
const controls = (page: Page) =>
  page.getByRole("group", { name: "カラーテーマ" });
const choice = (page: Page, name: string) =>
  controls(page).getByRole("button", { name, exact: true });
const expectDark = (page: Page, dark: boolean) =>
  dark
    ? expect(page.locator("html")).toHaveClass(/\bdark\b/)
    : expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

test("system is the default, follows OS changes, and explicit choices persist and sync tabs", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/signin");
  await expectDark(page, true);
  await expect(choice(page, "システム")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.emulateMedia({ colorScheme: "light" });
  await expectDark(page, false);
  await choice(page, "ダーク").click();
  await expectDark(page, true);
  await page.reload();
  await expectDark(page, true);
  await expect(choice(page, "ダーク")).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBe("dark");
  const other = await context.newPage();
  await other.emulateMedia({ colorScheme: "dark" });
  await other.goto("/signin");
  await expectDark(other, true);
  await choice(page, "ライト").click();
  await expectDark(page, false);
  await expectDark(other, false);
  await expect(choice(other, "ライト")).toHaveAttribute("aria-pressed", "true");
  await choice(page, "システム").click();
  await expectDark(page, false);
  await expectDark(other, true);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBeNull();
  await choice(page, "ダーク").focus();
  await page.keyboard.press("Enter");
  await expectDark(page, true);
  expect(errors).toEqual([]);
});

test("theme applies before hydration even when app chunks cannot load", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  const response = await page.goto("/signin", {
    waitUntil: "domcontentloaded",
  });
  await expectDark(page, true);
  const nonce = await page
    .locator("#theme-bootstrap")
    .evaluate((node: HTMLScriptElement) => node.nonce);
  expect(nonce).toBeTruthy();
  expect(response?.headers()["content-security-policy"]).toContain(
    `'nonce-${nonce}'`,
  );
  await page.evaluate((key) => localStorage.setItem(key, "light"), storageKey);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectDark(page, false);
});

test("blocked storage still allows theme switching without breaking the page", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      Storage.prototype[method] = () => {
        throw new DOMException("disabled", "SecurityError");
      };
    }
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/signin");
  await expectDark(page, true);
  await choice(page, "ライト").click();
  await expectDark(page, false);
  await expect(page.getByRole("status")).toContainText(
    "端末に設定を保存できない",
  );
  await choice(page, "システム").click();
  await expectDark(page, true);
  expect(errors).toEqual([]);
});

test("both themes cover sign-in, notes, CSV, dated logs, chat and personal practice", async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/signin");
  await page.screenshot({
    path: testInfo.outputPath("signin-dark.png"),
    fullPage: true,
  });
  await asAdmin(context);
  await page.goto("/");
  await upload(
    page,
    '"今天我很busy。","今天我很忙。","Jīntiān wǒ hěn máng.","忙＝忙しい","今日は、という意味の今天"',
  );
  await expect(page.getByText("1件の学習文を登録しました。")).toBeVisible();
  const paths = ["/", "/logs", "/chat", "/practice"];
  await page
    .getByRole("link", { name: "この日の一覧", exact: true })
    .first()
    .click();
  await page
    .getByRole("link", { name: "詳細を開く", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/logs\/\d{4}\/\d{1,2}\/\d{1,2}\/1$/);
  const detail = new URL(page.url()).pathname;
  paths.push(detail, detail.slice(0, detail.lastIndexOf("/")));
  for (const mode of ["ダーク", "ライト"]) {
    await choice(page, mode).click();
    for (const path of paths) {
      await page.goto(path);
      await expectDark(page, mode === "ダーク");
      await expect(choice(page, mode)).toHaveAttribute("aria-pressed", "true");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      expect(overflow, `${mode} ${path} viewport`).toBe(false);
      if (path === "/" || path === "/chat" || path === "/practice") {
        await page.screenshot({
          path: testInfo.outputPath(
            `${path === "/" ? "notes" : path.slice(1)}-${mode === "ダーク" ? "dark" : "light"}.png`,
          ),
          fullPage: true,
        });
      }
    }
    const contrasts = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      const luminance = (token: string) => {
        ctx.fillStyle = style.getPropertyValue(token);
        ctx.fillRect(0, 0, 1, 1);
        const rgb = [...ctx.getImageData(0, 0, 1, 1).data]
          .slice(0, 3)
          .map((v) => {
            const c = v / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      return [
        ["--foreground", "--background"],
        ["--muted-foreground", "--card"],
        ["--muted-foreground", "--muted"],
        ["--primary-foreground", "--primary"],
      ].map(([text, bg]) => {
        const a = luminance(text),
          b = luminance(bg);
        return {
          text,
          bg,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      });
    });
    for (const pair of contrasts)
      expect(
        pair.ratio,
        `${mode} ${pair.text}/${pair.bg}`,
      ).toBeGreaterThanOrEqual(4.5);
  }
  expect(errors).toEqual([]);
});
