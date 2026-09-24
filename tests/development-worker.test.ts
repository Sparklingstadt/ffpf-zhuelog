import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

test("development worker reports missing GitHub auth without running AI or requesting a publication permit", async () => {
  const commands: Record<string, unknown>[] = [];
  let finish!: () => void;
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const identity = {
    id: "dev-job",
    leaseToken: "11111111-1111-4111-8111-111111111111",
  };
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const command = JSON.parse(body);
    commands.push(command);
    response.setHeader("Content-Type", "application/json");
    if (command.action === "claim") {
      assert.deepEqual(command.capabilities, ["battery", "development"]);
      response.end(
        JSON.stringify({
          job:
            commands.length === 1
              ? {
                  ...identity,
                  phase: "issue",
                  originalText: "検索を改善したい",
                }
              : null,
        }),
      );
      if (commands.length === 3) finish();
    } else {
      assert.equal(command.action, "complete-issue");
      assert.deepEqual(command.result, { outcome: "unavailable" });
      response.end(JSON.stringify({ ok: true }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/line-worker.mts"],
    {
      env: {
        ...process.env,
        NODE_ENV: "development",
        CHAT_PROVIDER: "codex-local",
        VERCEL: "",
        LINE_DEV_ISSUES_ENABLED: "true",
        LINE_GH_BIN: "/does-not-exist-gh",
        CODEX_LOCAL_BIN: "/must-not-invoke-ai",
        LINE_WORKER_TOKEN: "a".repeat(64),
        LINE_WORKER_URL: `http://127.0.0.1:${address.port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (value) => (output += value));
  child.stderr.on("data", (value) => (output += value));
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 10000);
  try {
    await Promise.race([completed, exited.then(() => assert.fail(output))]);
    child.kill("SIGTERM");
    assert.equal(await exited, 0, output);
    assert.deepEqual(
      commands.map((command) => command.action),
      ["claim", "complete-issue", "claim"],
    );
    assert.doesNotMatch(output, /検索|token|GitHub auth|processing failed/);
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exited.catch(() => {});
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
