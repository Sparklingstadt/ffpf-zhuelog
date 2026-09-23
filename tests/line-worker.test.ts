import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

test("standalone LINE worker loads environment and polls once without invoking AI", async () => {
  let claims = 0;
  const token = "a".repeat(64);
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.equal(request.url, "/api/line/worker");
    assert.deepEqual(JSON.parse(body), { action: "claim" });
    claims++;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ job: null }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/line-worker.mts", "--once"],
      {
        env: {
          ...process.env,
          NODE_ENV: "development",
          CHAT_PROVIDER: "codex-local",
          VERCEL: "",
          LINE_WORKER_TOKEN: token,
          LINE_WORKER_URL: `http://127.0.0.1:${address.port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    }).finally(() => clearTimeout(timeout));
    assert.equal(code, 0, output);
    assert.equal(claims, 1);
    assert.match(output, /LINE worker started/);
    assert.doesNotMatch(output, /processing failed/);
    assert.ok(!output.includes(token));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
