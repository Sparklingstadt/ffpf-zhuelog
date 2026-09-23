// Intentionally fixed: never use the developer's DATABASE_URL or remote app.
export const databaseUrl =
  "postgresql://zhuelog_e2e:local-e2e-only@127.0.0.1:55439/zhuelog_e2e";
export const baseURL = "http://127.0.0.1:3107";
export const cookieName = "authjs.session-token";
export const lineTestConfig = {
  secret: "e2e-line-signature-only",
  userId: `U${"1".repeat(32)}`,
  botId: `U${"2".repeat(32)}`,
};

export function authSecret() {
  if (!process.env.ZHUELOG_E2E_SECRET)
    throw new Error("Run via the Playwright config.");
  return process.env.ZHUELOG_E2E_SECRET;
}
