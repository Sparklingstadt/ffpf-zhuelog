import { spawn, spawnSync } from "node:child_process";
import {
  authSecret,
  baseURL,
  databaseUrl,
  lineTestConfig,
} from "./environment";

// Explicit values take precedence over .env.local/.env.production.local.
const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  AUTH_SECRET: authSecret(),
  AUTH_URL: baseURL,
  NEXTAUTH_URL: baseURL,
  NEXTAUTH_SECRET: authSecret(),
  AUTH_TRUST_HOST: "true",
  AUTH_GITHUB_ID: "",
  AUTH_GITHUB_SECRET: "",
  AUTH_ALLOWED_GITHUB_LOGINS: "e2e-admin",
  OPENAI_API_KEY: "",
  CHAT_PROVIDER: "openai",
  LINE_INTEGRATION_ENABLED: "true",
  LINE_CHANNEL_SECRET: lineTestConfig.secret,
  LINE_CHANNEL_ACCESS_TOKEN: "test-only-never-send",
  LINE_ALLOWED_USER_ID: lineTestConfig.userId,
  LINE_BOT_USER_ID: lineTestConfig.botId,
  LINE_WORKER_TOKEN: authSecret(),
  NODE_ENV: "production",
};

for (const [bin, args] of [
  ["node_modules/prisma/build/index.js", ["migrate", "deploy"]],
  ["node_modules/next/dist/bin/next", ["build"]],
] as const) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3107",
  ],
  { env, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => process.exit(code ?? 0));
