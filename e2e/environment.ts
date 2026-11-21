import { createHmac } from "node:crypto";

// Intentionally fixed: never use the developer's DATABASE_URL or remote app.
export const databaseUrl =
  "postgresql://zhuelog_e2e:local-e2e-only@127.0.0.1:55439/zhuelog_e2e";
export const baseURL = "http://127.0.0.1:3107";

// The web signs in through the Go API (services/api), which e2e/server.ts
// starts next to it.
export const goApiURL = "http://127.0.0.1:3108";
export const cookieName = "zl_access";
// e2e/openai-stub.ts, which the web and the Go API call instead of OpenAI.
export const openAiStubURL = "http://127.0.0.1:3109";
// e2e/fixtures/ffpf-oidc-stub.ts, the FFPF ID issuer for the e2e run.
export const ffpfIssuerURL = "http://127.0.0.1:3110";
// e2e/line-stub.ts, which the web calls instead of the LINE Messaging API.
export const lineStubURL = "http://127.0.0.1:3111";

// This run's random secret, from the Playwright config.
function runSecret() {
  if (!process.env.ZHUELOG_E2E_SECRET)
    throw new Error("Run via the Playwright config.");
  return process.env.ZHUELOG_E2E_SECRET;
}

// Go API secrets for this run, derived from the run's random secret so the
// Playwright process and e2e/server.ts agree without passing more variables.
export function goJwtSecret() {
  return deriveSecret("api-jwt");
}

export function goProxySecret() {
  return deriveSecret("api-web-proxy");
}

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

// The demo account's loginId in this run (DEMO_LOGIN_ID).
export const demoLoginId = "demo";

function deriveSecret(label: string) {
  return createHmac("sha256", runSecret()).update(label).digest("hex");
}
