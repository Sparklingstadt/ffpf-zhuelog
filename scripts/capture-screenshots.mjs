import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

// Captures the README's screenshots (docs/images/) from a running local app:
// the web on BASE_URL and the local Go API with its sample data
// (docs/api-local.md). Signs in as the sample member "demo".
// Usage: pnpm run api:db && pnpm run api:dev, pnpm run dev, then
//   BASE_URL=http://localhost:3000 node scripts/capture-screenshots.mjs
const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = "docs/images";
const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };

await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
try {
  const context = await browser.newContext({
    viewport: desktop,
    colorScheme: "light",
    reducedMotion: "reduce",
    deviceScaleFactor: 2,
    locale: "ja-JP",
  });
  const page = await context.newPage();
  await page.goto(`${base}/signin`);
  await page.getByLabel("ログインID").fill(process.env.LOGIN_ID ?? "demo");
  await page
    .getByLabel("パスワード")
    .fill(process.env.LOGIN_PASSWORD ?? "demo-password-123");
  await page.getByRole("button", { name: "IDとパスワードでログイン" }).click();
  await page.waitForURL((url) => url.pathname === "/");

  const shot = async (name, path, size, prepare) => {
    await page.setViewportSize(size);
    await page.goto(`${base}${path}`);
    await page.waitForLoadState("networkidle");
    // The dev server's Next.js badge is not part of the app.
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    if (prepare) await prepare();
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`wrote ${out}/${name}.png`);
  };

  await shot("notes-desktop", "/", desktop);
  await shot("review-desktop", "/review", desktop);
  await shot("vocabulary-desktop", "/vocabulary", desktop);
  // A solved preposition question on a phone: the choices, the example and
  // "next" above the bottom tabs.
  await shot("practice-phone", "/practice/prepositions", phone, async () => {
    const choices = page.getByRole("group", { name: "介詞を選ぶ" });
    for (const button of await choices.getByRole("button").all()) {
      await button.click();
      if (await choices.getByRole("button", { name: /（正解）$/ }).count())
        break;
    }
    await page.getByRole("button", { name: "次へ" }).waitFor();
  });
  await shot("notes-phone", "/", phone);
} finally {
  await browser.close();
}
