// Isolated local verification. --live explicitly consumes a small Codex turn.
// No production secrets, OAuth calls or database writes are used.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { encode } from "next-auth/jwt";

const live = process.argv.includes("--live");
const baseURL = "http://127.0.0.1:3109";
const secret = randomBytes(32).toString("hex");
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3109",
  ],
  {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "development",
      CHAT_PROVIDER: "codex-local",
      AUTH_SECRET: secret,
      AUTH_URL: baseURL,
      AUTH_TRUST_HOST: "true",
      AUTH_GITHUB_ID: "local-test",
      AUTH_GITHUB_SECRET: "local-test",
      AUTH_ALLOWED_GITHUB_LOGINS: "e2e-admin",
      OPENAI_API_KEY: "",
      DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
      ...(live
        ? {}
        : { CODEX_LOCAL_BIN: resolve("tests/fixtures/codex-app-server.mjs") }),
    },
  },
);
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});
const browser = await chromium.launch();
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null)
      throw new Error(
        "Test server failed to start (is another next dev running?)",
      );
    try {
      ready = (await fetch(`${baseURL}/signin`)).ok;
    } catch {
      /* starting */
    }
    if (ready) break;
    await delay(300);
  }
  assert.ok(ready, "dev server ready");
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseURL}/chat`);
  assert.match(page.url(), /signin/);
  const cookieName = "authjs.session-token";
  async function login(role: "guest" | "admin") {
    const token = await encode({
      secret,
      salt: cookieName,
      maxAge: 600,
      token: {
        sub: `test-${role}`,
        name: "Local test",
        role,
        githubLogin: "e2e-admin",
      },
    });
    await page.context().addCookies([
      {
        name: cookieName,
        value: token,
        url: baseURL,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }
  await login("guest");
  assert.equal(
    (
      await page.request.post(`${baseURL}/api/chat`, {
        data: { messages: [] },
        headers: { Origin: baseURL },
      })
    ).status(),
    403,
  );
  await login("admin");
  assert.equal(
    (
      await page.request.post(`${baseURL}/api/chat`, {
        data: { messages: [] },
        headers: { Origin: "https://evil.example" },
      })
    ).status(),
    403,
  );
  await page.goto(`${baseURL}/chat`);
  await page
    .getByText("Codex Business · ローカル試作", { exact: true })
    .waitFor();
  await page
    .getByLabel("ChatGPTへのメッセージ")
    .fill("谢谢のピン音と日本語訳を一行で教えてください。");
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/chat"),
  );
  await page.getByRole("button", { name: "送信", exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, await response.text());
  await page
    .getByRole("button", { name: "送信", exact: true })
    .waitFor({ timeout: 60_000 });
  assert.equal(
    await page.getByText("応答を受信できませんでした", { exact: true }).count(),
    0,
    await page.locator("body").innerText(),
  );
  const text = await page.locator("body").innerText();
  assert.match(text, live ? /xiè/i : /nǐ hǎo/);
  await page.screenshot({
    path: "/private/tmp/zhuelog-codex-chat.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "クリア", exact: true }).click();
  await page.getByText("何を練習しますか？", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: live ? "Business live" : "offline fixture",
      model: "gpt-5.6-sol",
      checks: [
        "unauthenticated redirect",
        "guest 403",
        "cross-origin 403",
        "admin UI streaming",
        "clear conversation",
        "no browser errors",
      ],
      screenshot: "/private/tmp/zhuelog-codex-chat.png",
    }),
  );
} finally {
  await browser.close();
  if (server.pid) process.kill(-server.pid, "SIGTERM");
}
