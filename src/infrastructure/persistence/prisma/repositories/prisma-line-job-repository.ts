import { randomUUID } from "node:crypto";
import type { LineJobRepository } from "@/application/line/ports/line-job-repository";
import type { LineInput, LineJob } from "@/domain/line/line-learning";
import type { LearningEntryDraft } from "@/domain/learning/entities/learning-entry";
import { getPrismaClient } from "../prisma-client";
import { routeDevelopmentMessage } from "@/domain/line/development-routing";
import type { GenerationFailureCode } from "@/domain/line/generation-failure";

const leaseWhere = (job: LineJob) => ({
  id: job.id,
  leaseToken: job.leaseToken,
  status: job.status,
  availableAt: { gt: new Date() },
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
                  await tx.lineLearningJob.create({
                    data: { ...input, retryKey: randomUUID() },
                  });
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
      data: inputs.map((input) => ({ ...input, retryKey: randomUUID() })),
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
    const kinds = [
      "correction",
      ...(supportsBattery ? ["battery"] : []),
      ...(supportsDevelopment ? ["dev-issue", "dev-reply"] : []),
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
            status: { in: ["PENDING", "GENERATING"] },
            generationTries: { gte: 3 },
          },
          { status: { in: ["READY", "SENDING"] }, deliveryTries: { gte: 5 } },
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
          status: { in: ["PENDING", "GENERATING", "READY", "SENDING"] },
          availableAt: { lte: now },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (!job) return null;
      const generating = ["PENDING", "GENERATING"].includes(job.status);
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
        return prisma.lineLearningJob.findUniqueOrThrow({
          where: { id: job.id },
        });
    }
    return null;
  }

  leased(id: string, token: string, userId: string, status: string) {
    return getPrismaClient().lineLearningJob.findFirst({
      where: {
        id,
        leaseToken: token,
        userId,
        status,
        availableAt: { gt: new Date() },
      },
    });
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
        : !["battery", "dev-issue"].includes(job.kind)
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
    return result.count === 1;
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
