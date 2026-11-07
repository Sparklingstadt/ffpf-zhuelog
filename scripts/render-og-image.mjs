import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

// Renders scripts/og-image/opengraph-image.html (1200×630) with Chromium and
// writes the PNG that Next.js serves as the Open Graph / X card image.
// Usage: pnpm run og:render
//
// The template uses the system's Japanese font, so the PNG looks slightly
// different per machine. Commit the result and check it before pushing.
const template = resolve("scripts/og-image/opengraph-image.html");
const output = resolve("src/app/opengraph-image.png");
const size = { width: 1200, height: 630 };

// Normally the Chromium that `pnpm exec playwright install chromium` put in
// place; a different build can be named with PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
try {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(template).href);
  await page.evaluate(() => document.fonts.ready);
  await mkdir(dirname(output), { recursive: true });
  await page.screenshot({ path: output, clip: { x: 0, y: 0, ...size } });
  console.log(`wrote ${output}`);
} finally {
  await browser.close();
}
