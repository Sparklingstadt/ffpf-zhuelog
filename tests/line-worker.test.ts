import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

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

for (const scenario of [
  "drain",
  "conflict",
  "error",
  "not-ok",
  "once",
] as const) {
  test(`worker scheduling: ${scenario}`, async () => {
    const actions: string[] = [];
    const times: number[] = [];
    const token = "b".repeat(64);
    const identity = {
      id: "offline-job",
      leaseToken: "11111111-1111-4111-8111-111111111111",
    };
    let complete!: () => void;
    const reached = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      const command = JSON.parse(body);
      actions.push(command.action);
      times.push(performance.now());
      response.setHeader("Content-Type", "application/json");
      if (scenario === "error") {
        response.writeHead(503);
        response.end(JSON.stringify({ error: "UNAVAILABLE" }));
        complete();
      } else if (command.action === "claim") {
        const phase = actions.length === 1 ? "generate" : "deliver";
        response.end(
          JSON.stringify({
            job:
              actions.length < 5
                ? {
                    ...identity,
                    phase,
                    ...(phase === "generate"
                      ? { originalText: "今天我很busy。" }
                      : {}),
                  }
                : null,
          }),
        );
        if (actions.length === 5) complete();
      } else if (command.action === "complete") {
        assert.equal(command.id, identity.id);
        assert.equal(command.correction.correctedText, "今天我很忙。");
        if (scenario === "conflict") response.statusCode = 409;
        response.end(
          JSON.stringify({
            ok: scenario !== "conflict" && scenario !== "not-ok",
          }),
        );
        if (scenario !== "drain") complete();
      } else {
        assert.equal(command.action, "deliver");
        assert.equal(command.leaseToken, identity.leaseToken);
        response.end(JSON.stringify({ ok: true }));
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/line-worker.mts",
        ...(scenario === "once" ? ["--once"] : []),
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: "development",
          CHAT_PROVIDER: "codex-local",
          VERCEL: "",
          CODEX_LOCAL_BIN: resolve("tests/fixtures/codex-app-server.mjs"),
          LINE_WORKER_TOKEN: token,
          LINE_WORKER_URL: `http://127.0.0.1:${address.port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    const deadline = setTimeout(() => child.kill("SIGKILL"), 6000);
    try {
      await Promise.race([
        reached,
        exited.then(() => assert.fail(`worker exited too early: ${output}`)),
      ]);
      // Empty queues and failed/ambiguous responses must not busy-poll.
      await delay(500);
      const expected =
        scenario === "drain"
          ? ["claim", "complete", "claim", "deliver", "claim"]
          : scenario === "error"
            ? ["claim"]
            : ["claim", "complete"];
      assert.deepEqual(actions, expected);
      if (scenario === "drain") {
        assert.ok(
          times[2] - times[1] < 2000,
          "save -> delivery claim should not sleep",
        );
        assert.ok(
          times[4] - times[3] < 2000,
          "delivery -> next claim should not sleep",
        );
      }
      if (scenario !== "once") child.kill("SIGTERM");
      assert.equal(await exited, 0, output);
      assert.ok(!output.includes(token));
      assert.ok(!output.includes("今天我很busy"));
    } finally {
      clearTimeout(deadline);
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await exited.catch(() => {});
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
