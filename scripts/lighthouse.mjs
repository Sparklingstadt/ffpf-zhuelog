import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";

// Runs Lighthouse on the production pages, as a phone and as a desktop, and
// writes an HTML report per page to lighthouse-reports/ (not committed) and a
// summary to stdout. The sign-in page is measured signed out; the others in
// the demo account ("デモで試す"), so the members' pages can be measured too.
// Usage: pnpm run quality:lighthouse  (BASE_URL to measure another host)
const base = process.env.BASE_URL ?? "https://ffpf-zhuelog.sparklingstadt.com";
const out = "lighthouse-reports";
const port = 9333;
const pages = [
  ["ログイン", "/signin", false],
  ["学習ノート", "/", true],
  ["今日の復習", "/review", true],
  ["単語帳", "/vocabulary", true],
  ["練習の入口", "/practice", true],
  ["介詞の練習", "/practice/prepositions", true],
];
const forms = [
  ["スマホ", undefined],
  ["PC", desktopConfig],
];

await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "zhuelog-lighthouse-"));
// One persistent profile, so Lighthouse measures in the context that holds
// the demo session's cookies.
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: [`--remote-debugging-port=${port}`],
});
const rows = [];
try {
  for (const [label, path, signedIn] of pages) {
    if (signedIn && !(await signedInToDemo(context))) await enterDemo(context);
    if (!signedIn) await context.clearCookies();
    for (const [form, config] of forms) {
      await clearCache(context);
      const result = await lighthouse(
        `${base}${path}`,
        {
          port,
          output: "html",
          logLevel: "error",
          // Keep the cookies: storage reset would sign the demo out. The
          // cache is cleared before each run instead.
          disableStorageReset: true,
        },
        config,
      );
      const { lhr } = result;
      const name = `${path === "/" ? "home" : path.slice(1).replaceAll("/", "-")}-${form === "PC" ? "desktop" : "mobile"}`;
      await writeFile(join(out, `${name}.html`), result.report);
      const score = (id) => Math.round((lhr.categories[id]?.score ?? 0) * 100);
      const audit = (id) => lhr.audits[id]?.displayValue ?? "—";
      rows.push({
        ページ: label,
        幅: form,
        性能: score("performance"),
        アクセシビリティ: score("accessibility"),
        ベストプラクティス: score("best-practices"),
        SEO: score("seo"),
        LCP: audit("largest-contentful-paint"),
        TBT: audit("total-blocking-time"),
        CLS: audit("cumulative-layout-shift"),
        失敗した監査: Object.values(lhr.audits)
          .filter(
            (a) =>
              a.score !== null &&
              a.score < 0.9 &&
              ["binary", "numeric"].includes(a.scoreDisplayMode) &&
              lhr.categories.accessibility.auditRefs
                .concat(lhr.categories["best-practices"].auditRefs)
                .concat(lhr.categories.seo.auditRefs)
                .some((ref) => ref.id === a.id),
          )
          .map((a) => a.id)
          .join(" "),
      });
      console.error(`measured ${label} (${form})`);
    }
  }
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
console.log(JSON.stringify(rows, null, 1));

// Clears the HTTP cache but not the cookies, so each run loads the page cold
// while staying in the demo.
async function clearCache(context) {
  const page = context.pages()[0] ?? (await context.newPage());
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.clearBrowserCache");
  await cdp.detach();
}

async function signedInToDemo(context) {
  return (await context.cookies(base)).some((c) => c.name === "zl_access");
}

async function enterDemo(context) {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${base}/signin`);
  await page.getByRole("button", { name: "デモで試す" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}
