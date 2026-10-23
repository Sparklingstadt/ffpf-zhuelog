import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  baseURL,
  databaseUrl,
  goApiURL,
  goJwtSecret,
  goProxySecret,
} from "./environment";

async function main() {
  // Explicit values take precedence over .env.local/.env.production.local.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // For prisma migrate deploy; the web itself reads no database.
    DATABASE_URL: databaseUrl,
    AUTH_URL: baseURL,
    GO_API_URL: goApiURL,
    API_WEB_PROXY_SECRET: goProxySecret(),
    // Only shows the GitHub button; the e2e never completes a GitHub login.
    AUTH_GITHUB_ID: "e2e-client",
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

  const api = await startGoApi();
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
    process.on(signal, () => {
      api.kill(signal);
      server.kill(signal);
    });
  }
  api.on("exit", (code) => {
    console.error(`Go API exited (${code}); stopping the web server.`);
    server.kill("SIGTERM");
  });
  server.on("exit", (code) => {
    api.removeAllListeners("exit");
    api.kill("SIGTERM");
    process.exit(code ?? 0);
  });
}

// Builds services/api and runs it against the same e2e database.
async function startGoApi(): Promise<ChildProcess> {
  const directory = mkdtempSync(join(tmpdir(), "zhuelog-e2e-"));
  const binary = join(directory, "api");
  const build = spawnSync("go", ["build", "-o", binary, "."], {
    cwd: "services/api",
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);

  const api = spawn(binary, [], {
    env: {
      ...process.env,
      PORT: new URL(goApiURL).port,
      DATABASE_URL: databaseUrl,
      API_JWT_SECRET: goJwtSecret(),
      AUTH_ALLOWED_GITHUB_IDS: "10001", // adminOwnerId in fixtures.ts
      API_WEB_PROXY_SECRET: goProxySecret(),
      GITHUB_MOBILE_CLIENT_ID: "e2e-mobile-client",
      GITHUB_MOBILE_CLIENT_SECRET: "e2e-mobile-secret",
      GITHUB_MOBILE_REDIRECT_URI: "zhuelog-e2e://oauth/callback",
      GITHUB_WEB_CLIENT_ID: "",
      GITHUB_WEB_CLIENT_SECRET: "",
      GITHUB_WEB_REDIRECT_URI: "",
      // Go registers the LINE link routes only when LINE and OpenAI are
      // configured. Dummy values and loopback base URLs (nothing listens on
      // port 9) make the routes exist without any call leaving this machine.
      LINE_CHANNEL_SECRET: "e2e-line-channel-secret",
      LINE_CHANNEL_ACCESS_TOKEN: "e2e-line-channel-access-token",
      OPENAI_API_KEY: "e2e-openai-api-key",
      LINE_API_BASE_URL: "http://127.0.0.1:9",
      OPENAI_API_BASE_URL: "http://127.0.0.1:9",
    },
    stdio: "inherit",
  });
  let exited = false;
  api.once("exit", () => (exited = true));

  try {
    const deadline = Date.now() + 30_000;
    while (!exited && Date.now() < deadline) {
      try {
        if ((await fetch(`${goApiURL}/ping`)).ok) return api;
      } catch {
        // Not listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    api.kill("SIGTERM");
    throw new Error("The Go API did not answer /ping.");
  } finally {
    // Playwright may SIGKILL this process, so no exit hook would run. A
    // running binary can be unlinked, so remove it once the API is up.
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
