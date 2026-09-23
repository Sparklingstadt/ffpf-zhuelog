import nextEnv from "@next/env";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { correctLineText } from "../src/infrastructure/line/codex-line-corrector";
import { isCodexLocalEnabled } from "../src/infrastructure/chat/codex-local-policy";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
if (!isCodexLocalEnabled())
  throw new Error("Use npm run line:worker on this Mac only.");
const target = new URL(process.env.LINE_WORKER_URL || "http://localhost:3000");
if (
  target.username ||
  target.password ||
  target.search ||
  target.hash ||
  target.pathname !== "/" ||
  (target.protocol !== "https:" &&
    !(
      target.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
    ))
) {
  throw new Error(
    "LINE_WORKER_URL must be an HTTPS origin (HTTP loopback allowed for tests).",
  );
}
const token = process.env.LINE_WORKER_TOKEN || "";
if (!/^[0-9a-f]{64}$/i.test(token))
  throw new Error("Configure a dedicated 32-byte hex LINE_WORKER_TOKEN.");
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => stop.abort());
const jobSchema = z.object({
  id: z.string().min(1).max(100),
  leaseToken: z.string().uuid(),
  phase: z.enum(["generate", "deliver"]),
  originalText: z.string().min(1).max(500).optional(),
});
async function call(command: unknown) {
  const result = await fetch(new URL("/api/line/worker", target), {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.any([stop.signal, AbortSignal.timeout(20_000)]),
  });
  // A lost completion response can be followed by 409. It is not permission
  // to generate again; the server queue remains the source of truth.
  if (result.status === 409) return null;
  if (!result.ok) throw new Error(`WORKER_HTTP_${result.status}`);
  return result.json();
}

console.log(
  "LINE worker started. Outbound polling only; no listening port. Ctrl+C to stop.",
);
while (!stop.signal.aborted) {
  try {
    const response = await call({ action: "claim" });
    const job = response?.job ? jobSchema.parse(response.job) : null;
    if (job) {
      const identity = { id: job.id, leaseToken: job.leaseToken };
      if (job.phase === "deliver")
        await call({ action: "deliver", ...identity });
      else {
        let correction;
        try {
          if (!job.originalText) throw new Error("MISSING_TEXT");
          correction = await correctLineText(job.originalText, stop.signal);
        } catch {
          if (!stop.signal.aborted) await call({ action: "fail", ...identity });
          throw new Error("CORRECTION_FAILED");
        }
        await call({ action: "complete", ...identity, correction });
      }
      // No original text, CSV, LINE user ID, token or raw provider error in logs.
      console.log(`LINE job ${job.id}: ${job.phase} processed`);
    }
  } catch {
    if (!stop.signal.aborted)
      console.error(
        "LINE processing failed. Check settings/usage and job status; retries are bounded.",
      );
  }
  if (process.argv.includes("--once")) break;
  try {
    await delay(15_000, undefined, { signal: stop.signal });
  } catch {
    break;
  }
}
