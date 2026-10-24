import { createHmac } from "node:crypto";

// Intentionally fixed: never use the developer's DATABASE_URL or remote app.
export const databaseUrl =
  "postgresql://zhuelog_e2e:local-e2e-only@127.0.0.1:55439/zhuelog_e2e";
export const baseURL = "http://127.0.0.1:3107";

// The web signs in through the Go API (services/api), which e2e/server.ts
// starts next to it.
export const goApiURL = "http://127.0.0.1:3108";
export const cookieName = "zl_access";
// e2e/openai-stub.ts, which the Go API calls instead of OpenAI.
export const openAiStubURL = "http://127.0.0.1:3109";

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

function deriveSecret(label: string) {
  return createHmac("sha256", runSecret()).update(label).digest("hex");
}
