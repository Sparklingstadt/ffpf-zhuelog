import { z } from "zod";
import type { LineJobRepository } from "@/application/line/ports/line-job-repository";
import type { ProcessLineLearning } from "@/application/line/use-cases/process-line-learning";
import { correctionSchema } from "@/domain/line/line-learning";
import { batteryReportSchema } from "@/domain/line/battery-report";
import {
  readLimitedBody,
  verifyWorkerToken,
} from "@/infrastructure/line/security";
import type { getLineConfig } from "@/infrastructure/line/config";

const identity = {
  id: z.string().min(1).max(100),
  leaseToken: z.string().uuid(),
};
const commandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("claim"),
      capabilities: z.array(z.literal("battery")).max(1).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("complete-battery"),
      ...identity,
      report: batteryReportSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("complete"),
      ...identity,
      correction: correctionSchema,
    })
    .strict(),
  z.object({ action: z.literal("deliver"), ...identity }).strict(),
  z.object({ action: z.literal("fail"), ...identity }).strict(),
]);

export async function handleLineWorker(
  request: Request,
  config: ReturnType<typeof getLineConfig>,
  jobs: LineJobRepository,
  service: ProcessLineLearning,
) {
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!config) return json({ error: "LINE_DISABLED" }, 503);
  if (
    !verifyWorkerToken(request.headers.get("authorization"), config.workerToken)
  )
    return json({ error: "UNAUTHORIZED" }, 401);
  let command: z.infer<typeof commandSchema>;
  try {
    command = commandSchema.parse(
      JSON.parse((await readLimitedBody(request, 16 * 1024)).toString("utf8")),
    );
  } catch {
    return json({ error: "INVALID_COMMAND" }, 400);
  }
  try {
    if (command.action === "claim") {
      const job = await jobs.claim(
        config.userId,
        command.capabilities?.includes("battery") ?? false,
      );
      return json({
        job: job
          ? {
              id: job.id,
              leaseToken: job.leaseToken,
              phase:
                job.status === "GENERATING"
                  ? job.kind === "battery"
                    ? "battery"
                    : "generate"
                  : "deliver",
              ...(job.status === "GENERATING" && job.kind === "correction"
                ? { originalText: job.originalText }
                : {}),
            }
          : null,
      });
    }
    const { id, leaseToken } = command;
    const ok =
      command.action === "complete"
        ? await service.complete(
            id,
            leaseToken,
            config.userId,
            command.correction,
          )
        : command.action === "complete-battery"
          ? await service.completeBattery(
              id,
              leaseToken,
              config.userId,
              command.report,
            )
          : command.action === "deliver"
            ? await service.deliver(id, leaseToken, config.userId)
            : await service.generationFailed(id, leaseToken, config.userId);
    return json({ ok }, ok ? 200 : 409);
  } catch {
    return json({ error: "PROCESSING_FAILED" }, 503);
  }
}
