import { expect, test } from "./fixtures";
import { baseURL } from "./environment";

// What crawlers and link previews (X, LINE, Slack, …) see without a session.

test("the sign-in page carries OGP and X card tags with an absolute image", async ({
  page,
}) => {
  await page.goto("/signin");
  await expect(page).toHaveTitle("ログイン | 学习録");
  const meta = (selector: string) =>
    page.locator(`head ${selector}`).first().getAttribute("content");
  expect(await meta('meta[property="og:site_name"]')).toBe("学习録");
  expect(await meta('meta[property="og:type"]')).toBe("website");
  expect(await meta('meta[property="og:locale"]')).toBe("ja_JP");
  expect(await meta('meta[name="twitter:card"]')).toBe("summary_large_image");
  const image = await meta('meta[property="og:image"]');
  expect(image).toMatch(new RegExp(`^${baseURL}/opengraph-image`));
  expect(await meta('meta[name="twitter:image"]')).toBe(image);
  expect(
    await page
      .locator('head link[rel="canonical"]')
      .first()
      .getAttribute("href"),
  ).toBe(`${baseURL}/signin`);

  // The image itself is public, so the preview can fetch it.
  const response = await page.request.get(image!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
});

test("robots.txt and sitemap.xml are public and point at each other", async ({
  request,
}) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const rules = await robots.text();
  expect(rules).toContain("Disallow: /api/");
  expect(rules).toContain(`Sitemap: ${baseURL}/sitemap.xml`);

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml).toContain(`<loc>${baseURL}/signin</loc>`);
  expect(xml).not.toContain("/logs");
});
