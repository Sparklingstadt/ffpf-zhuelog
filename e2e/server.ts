import { spawn, spawnSync } from "node:child_process";
import {
  baseURL,
  betterAuthSecret,
  databaseUrl,
  demoLoginId,
  demoPassword,
  sidIssuerURL,
  cronSecret,
  lineAccessToken,
  lineChannelSecret,
  lineStubURL,
  openAiStubURL,
} from "./environment";
import { startSidOidcStub } from "./fixtures/sid-oidc-stub";
import { startLineStub } from "./line-stub";
import { startOpenAiStub } from "./openai-stub";

// Sparklingstadt ID for this run: the stub is the issuer, and the web is its client.
// The secret is a fixed test value; the stub runs on loopback only.
const sid = {
  issuer: sidIssuerURL,
  clientId: "e2e-sid-client",
  clientSecret: "e2e-sid-client-secret",
  // Better Auth's callback for the "sid" provider (/callback/:id under
  // /api/auth in better-auth 1.7).
  redirectUri: `${baseURL}/api/auth/callback/sid`,
};

async function main() {
  // Explicit values take precedence over .env.local/.env.production.local.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // For prisma migrate deploy, and read by the web at runtime (who is
    // signed in).
    DATABASE_URL: databaseUrl,
    AUTH_URL: baseURL,
    BETTER_AUTH_SECRET: betterAuthSecret(),
    // The demo button signs in to this account with this password; the
    // fixtures that make the demo account store its hash.
    DEMO_LOGIN_ID: demoLoginId,
    DEMO_PASSWORD: demoPassword(),
    LINE_OFFICIAL_ACCOUNT_ID: "@393bohaw",
    LINE_LINK_PREVIEW_MODE: "false",
    // Shows the Sparklingstadt ID button; sign-in completes against the local stub.
    SID_ISSUER: sid.issuer,
    SID_CLIENT_ID: sid.clientId,
    SID_CLIENT_SECRET: sid.clientSecret,
    // The web drafts vocabulary and answers quick questions with OpenAI
    // itself; the base URL is the loopback stub, so nothing leaves this
    // machine.
    OPENAI_API_KEY: "e2e-openai-api-key",
    OPENAI_API_BASE_URL: openAiStubURL,
    // The web receives LINE itself: e2e/line.spec.ts signs webhooks with
    // this secret, and replies and pushes go to the loopback stub.
    LINE_CHANNEL_SECRET: lineChannelSecret(),
    LINE_CHANNEL_ACCESS_TOKEN: lineAccessToken(),
    LINE_API_BASE_URL: lineStubURL,
    // The web's cron routes (the daily LINE pass).
    CRON_SECRET: cronSecret(),
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

  await startOpenAiStub(Number(new URL(openAiStubURL).port));
  await startLineStub(Number(new URL(lineStubURL).port), lineAccessToken());
  await startSidOidcStub({ ...sid, port: Number(new URL(sid.issuer).port) });
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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
