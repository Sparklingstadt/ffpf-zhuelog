import { createHmac } from "node:crypto";

// Intentionally fixed: never use the developer's DATABASE_URL or remote app.
export const databaseUrl =
  "postgresql://zhuelog_e2e:local-e2e-only@127.0.0.1:55439/zhuelog_e2e";
export const baseURL = "http://127.0.0.1:3107";

// ZHUELOG_E2E_AUTH=go runs the suite with the web signing in through the Go
// API (services/api). Unset runs it on Auth.js, as before.
export const authMode = parseAuthMode(process.env.ZHUELOG_E2E_AUTH);
export const goApiURL = "http://127.0.0.1:3108";
export const cookieName =
  authMode === "go" ? "zl_access" : "authjs.session-token";

function parseAuthMode(value: string | undefined): "authjs" | "go" {
  if (!value || value === "authjs") return "authjs";
  if (value === "go") return "go";
  throw new Error('ZHUELOG_E2E_AUTH must be "authjs" or "go".');
}

export function authSecret() {
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
  return createHmac("sha256", authSecret()).update(label).digest("hex");
}
