import { createHmac } from "node:crypto";

// Intentionally fixed: never use the developer's DATABASE_URL or remote app.
export const databaseUrl =
  "postgresql://zhuelog_e2e:local-e2e-only@127.0.0.1:55439/zhuelog_e2e";
export const baseURL = "http://127.0.0.1:3107";

// Better Auth's session cookie (plain HTTP, so without the __Secure- prefix).
export const sessionCookieName = "better-auth.session_token";
// e2e/openai-stub.ts, which the web calls instead of OpenAI.
export const openAiStubURL = "http://127.0.0.1:3109";
// e2e/fixtures/sid-oidc-stub.ts, the Sparklingstadt ID issuer for the e2e run.
export const sidIssuerURL = "http://127.0.0.1:3110";
// e2e/line-stub.ts, which the web calls instead of the LINE Messaging API.
export const lineStubURL = "http://127.0.0.1:3111";

// This run's random secret, from the Playwright config.
function runSecret() {
  if (!process.env.ZHUELOG_E2E_SECRET)
    throw new Error("Run via the Playwright config.");
  return process.env.ZHUELOG_E2E_SECRET;
}

// The secrets below are derived from the run's random secret so the
// Playwright process and e2e/server.ts agree without passing more variables.

// Guards the web's cron routes.
export function cronSecret() {
  return deriveSecret("api-cron");
}

// The web's LINE channel: the webhook's signing secret and the token it
// presents to e2e/line-stub.ts.
export function lineChannelSecret() {
  return deriveSecret("line-channel");
}

export function lineAccessToken() {
  return deriveSecret("line-access");
}

// Signs the web's Better Auth cookies (BETTER_AUTH_SECRET).
export function betterAuthSecret() {
  return deriveSecret("better-auth");
}

// The demo account's loginId in this run (DEMO_LOGIN_ID).
export const demoLoginId = "demo";

// The demo account's password (DEMO_PASSWORD): the demo button signs in with
// it, so the fixture that makes the demo account stores its hash.
export function demoPassword() {
  return deriveSecret("demo-password").slice(0, 24);
}

function deriveSecret(label: string) {
  return createHmac("sha256", runSecret()).update(label).digest("hex");
}
