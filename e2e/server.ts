import { spawn, spawnSync } from "node:child_process";
import {
  baseURL,
  databaseUrl,
  demoLoginId,
  ffpfIssuerURL,
  cronSecret,
  lineAccessToken,
  lineChannelSecret,
  lineStubURL,
  openAiStubURL,
} from "./environment";
import { startFfpfOidcStub } from "./fixtures/ffpf-oidc-stub";
import { startLineStub } from "./line-stub";
import { startOpenAiStub } from "./openai-stub";

// FFPF ID for this run: the stub is the issuer, and the web is its client.
// The secret is a fixed test value; the stub runs on loopback only.
const ffpf = {
  issuer: ffpfIssuerURL,
  clientId: "e2e-ffpf-client",
  clientSecret: "e2e-ffpf-client-secret",
  redirectUri: `${baseURL}/api/auth/callback/ffpf`,
};

async function main() {
  // Explicit values take precedence over .env.local/.env.production.local.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // For prisma migrate deploy, and read by the web at runtime (who is
    // signed in).
    DATABASE_URL: databaseUrl,
    AUTH_URL: baseURL,
    AUTH_ALLOWED_GITHUB_IDS: "10001", // adminOwnerId in fixtures.ts
    DEMO_LOGIN_ID: demoLoginId,
    // Enables the GitHub button only; there is no GitHub stub and the e2e
    // never completes a GitHub sign-in.
    AUTH_GITHUB_ID: "e2e-client",
    GITHUB_WEB_CLIENT_SECRET: "e2e-github-secret",
    LINE_OFFICIAL_ACCOUNT_ID: "@393bohaw",
    LINE_LINK_PREVIEW_MODE: "false",
    // Shows the FFPF ID button; sign-in completes against the local stub.
    FFPF_ID_ISSUER: ffpf.issuer,
    FFPF_ID_CLIENT_ID: ffpf.clientId,
    FFPF_ID_CLIENT_SECRET: ffpf.clientSecret,
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
  await startFfpfOidcStub({ ...ffpf, port: Number(new URL(ffpf.issuer).port) });
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
