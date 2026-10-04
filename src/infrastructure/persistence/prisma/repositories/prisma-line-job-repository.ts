import { randomUUID } from "node:crypto";
import type { LineJobRepository } from "@ffpf-zhuelog/core/domain/line/repositories/line-job-repository";
import {
  lineTextTooLongReply,
  type LineInput,
  type LineJob,
  type LineJobKind,
  type LineJobStatus,
} from "@ffpf-zhuelog/core/domain/line/line-learning";
import type { LearningEntryDraft } from "@ffpf-zhuelog/core/domain/learning/entities/learning-entry";
import { getPrismaClient } from "../prisma-client";
import { toLineJob } from "../mappers/line-job-mapper";
import { routeDevelopmentMessage } from "@ffpf-zhuelog/core/domain/line/development-routing";
import type { GenerationFailureCode } from "@ffpf-zhuelog/core/domain/line/generation-failure";

const leaseWhere = (job: LineJob) => ({
  id: job.id,
  leaseToken: job.leaseToken,
  status: job.status,
  availableAt: { gt: new Date() },
});

// Oversized text is answered directly: no generation, only the notice.
const jobData = (input: LineInput) => ({
  ...input,
  retryKey: randomUUID(),
  ...(input.kind === "text-too-long"
    ? { status: "READY", replyText: lineTextTooLongReply }
    : {}),
});

export class PrismaLineJobRepository implements LineJobRepository {
  async enqueue(inputs: LineInput[]) {
    if (!inputs.length) return;
    const prisma = getPrismaClient();
    // Mode changes and the durable reply/issue inbox are one transaction.
    // Deduplicate before changing mode, including old /dev redeliveries.
    if (inputs.some((input) => input.kind === "development-input")) {
      for (const input of [...inputs].sort(
        (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
      )) {
        for (let attempt = 0; ; attempt++) {
          try {
            await prisma.$transaction(
              async (tx) => {
                if (
                  await tx.lineLearningJob.findUnique({
                    where: { eventId: input.eventId },
                  })
                )
                  return;
                if (input.kind !== "development-input") {
                  await tx.lineLearningJob.create({ data: jobData(input) });
                  return;
                }
                const session = await tx.lineDevelopmentSession.upsert({
                  where: { userId: input.userId },
                  update: {},
                  create: { userId: input.userId, lastEventAt: new Date(0) },
                });
                const routed = routeDevelopmentMessage(input, session);
                await tx.lineDevelopmentSession.update({
                  where: { userId: input.userId },
                  data: routed.session,
                });
                await tx.lineLearningJob.create({
                  data: {
                    ...input,
                    ...routed.job,
                    retryKey: randomUUID(),
                  },
                });
              },
              { isolationLevel: "Serializable" },
            );
            break;
          } catch (error) {
            const code = (error as { code?: string }).code;
            if (attempt >= 3 || !["P2034", "P2002"].includes(code ?? ""))
              throw error;
          }
        }
      }
      return;
    }
    // Unique event IDs also deduplicate webhook redeliveries after success.
    await prisma.lineLearningJob.createMany({
      data: inputs.map(jobData),
      skipDuplicates: true,
    });
  }

  async claim(
    userId: string,
    supportsBattery = false,
    supportsDevelopment = false,
  ): Promise<LineJob | null> {
    const prisma = getPrismaClient();
    const now = new Date();
    const kinds: LineJobKind[] = [
      "correction",
      "text-too-long",
      ...(supportsBattery ? (["battery"] as const) : []),
      ...(supportsDevelopment ? (["dev-issue", "dev-reply"] as const) : []),
    ];
    await prisma.lineLearningJob.updateMany({
      where: {
        userId,
        kind: {
          in: kinds,
        },
        availableAt: { lte: now },
        OR: [
          {
            status: {
              in: ["PENDING", "GENERATING"] satisfies LineJobStatus[],
            },
            generationTries: { gte: 3 },
          },
          {
            status: { in: ["READY", "SENDING"] satisfies LineJobStatus[] },
            deliveryTries: { gte: 5 },
          },
        ],
      },
      data: {
        status: "FAILED",
        leaseToken: null,
        failureCode: "ATTEMPTS_EXHAUSTED",
      },
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      const job = await prisma.lineLearningJob.findFirst({
        where: {
          userId,
          kind: {
            in: kinds,
          },
          status: {
            in: [
              "PENDING",
              "GENERATING",
              "READY",
              "SENDING",
            ] satisfies LineJobStatus[],
          },
          availableAt: { lte: now },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (!job) return null;
      const generating =
        job.status === "PENDING" || job.status === "GENERATING";
      const leaseToken = randomUUID();
      const claimed = await prisma.lineLearningJob.updateMany({
        where: {
          id: job.id,
          status: job.status,
          availableAt: { lte: now },
          leaseToken: job.leaseToken,
        },
        data: {
          status: generating ? "GENERATING" : "SENDING",
          leaseToken,
          availableAt: new Date(Date.now() + 120_000),
          ...(generating
            ? { generationTries: { increment: 1 } }
            : {
                deliveryTries: { increment: 1 },
                firstDeliveryAt: job.firstDeliveryAt ?? now,
              }),
        },
      });
      if (claimed.count)
        return toLineJob(
          await prisma.lineLearningJob.findUniqueOrThrow({
            where: { id: job.id },
          }),
        );
    }
    return null;
  }

  async leased(
    id: string,
    token: string,
    userId: string,
    status: LineJobStatus,
  ) {
    return toLineJob(
      await getPrismaClient().lineLearningJob.findFirst({
        where: {
          id,
          leaseToken: token,
          userId,
          status,
          availableAt: { gt: new Date() },
        },
      }),
    );
  }

  async saveResult(job: LineJob, draft: LearningEntryDraft, csv: string) {
    if (job.kind !== "correction") return false;
    return getPrismaClient().$transaction(async (tx) => {
      const locked = await tx.lineLearningJob.updateMany({
        where: { ...leaseWhere(job), kind: "correction" },
        data: {
          status: "READY",
          leaseToken: null,
          csv,
          availableAt: new Date(),
          failureCode: null,
        },
      });
      if (!locked.count) return false;
      const batch = await tx.importBatch.create({
        data: { fileName: `line-${job.eventId}.csv`, rowCount: 1 },
      });
      const entry = await tx.learningEntry.create({
        data: {
          batchId: batch.id,
          originalText: draft.originalText,
          correctedText: draft.correctedText,
          pinyin: draft.pinyin,
          // Group by when LINE accepted the user's message, not when the Mac woke.
          createdAt: job.receivedAt,
          hints: {
            create: draft.hints.map((content, position) => ({
              content,
              position,
            })),
          },
        },
      });
      await tx.lineLearningJob.update({
        where: { id: job.id },
        data: { entryId: entry.id },
      });
      return true;
    });
  }

  async saveReply(
    job: LineJob,
    text: string,
    failureCode?: GenerationFailureCode,
  ) {
    if (
      job.kind === "correction"
        ? !failureCode
        : job.kind !== "battery" && job.kind !== "dev-issue"
    )
      return false;
    const result = await getPrismaClient().lineLearningJob.updateMany({
      where: { ...leaseWhere(job), kind: job.kind },
      data: {
        status: "READY",
        leaseToken: null,
        replyText: text,
        availableAt: new Date(),
        failureCode: failureCode ?? null,
      },
    });
    const saved = result.count === 1;
    // Only corrections carry a failure code. Log the code, never the text.
    if (saved && failureCode)
      console.warn(
        JSON.stringify({
          event: "line_correction_failed",
          at: new Date().toISOString(),
          jobId: job.id,
          code: failureCode,
        }),
      );
    return saved;
  }

  async beginIssue(job: LineJob) {
    if (job.kind !== "dev-issue") return false;
    // A single-use publication permit. After a timeout/crash, only read-back
    // reconciliation is allowed, never a second GitHub create request.
    const result = await getPrismaClient().lineLearningJob.updateMany({
      where: { ...leaseWhere(job), kind: "dev-issue", issueAttempted: false },
      data: { issueAttempted: true },
    });
    return result.count === 1;
  }

  async finishDelivery(job: LineJob) {
    await getPrismaClient().lineLearningJob.updateMany({
      where: leaseWhere(job),
      data: {
        status: "SENT",
        leaseToken: null,
        ...(job.kind === "correction" && job.replyText
          ? {}
          : { failureCode: null }),
      },
    });
  }

  async fail(job: LineJob, permanent: boolean, code: string) {
    const generating = job.status === "GENERATING";
    const tries = generating ? job.generationTries : job.deliveryTries;
    const exhausted = tries >= (generating ? 3 : 5);
    await getPrismaClient().lineLearningJob.updateMany({
      where: leaseWhere(job),
      data: {
        status:
          permanent || exhausted ? "FAILED" : generating ? "PENDING" : "READY",
        leaseToken: null,
        ...(job.kind === "correction" && job.replyText
          ? {}
          : { failureCode: code }),
        availableAt: new Date(Date.now() + 30_000 * 2 ** tries),
      },
    });
  }
}
