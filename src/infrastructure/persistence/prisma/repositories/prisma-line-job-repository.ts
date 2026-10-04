import { randomUUID } from "node:crypto";
import type { LineJobRepository } from "@ffpf-zhuelog/core/domain/line/repositories/line-job-repository";
import {
  ACTIVE_LINE_JOB_KINDS,
  lineTextTooLongReply,
  type LineInput,
  type LineJob,
  type LineJobStatus,
} from "@ffpf-zhuelog/core/domain/line/line-learning";
import type { LearningEntryDraft } from "@ffpf-zhuelog/core/domain/learning/entities/learning-entry";
import { getPrismaClient } from "../prisma-client";
import { toLineJob } from "../mappers/line-job-mapper";
import type { GenerationFailureCode } from "@ffpf-zhuelog/core/domain/line/generation-failure";

// Corrections and translations are generated; they alone save notes and
// carry generation failure codes.
const isGenerated = (kind: LineJob["kind"]) =>
  kind === "correction" || kind === "translation";

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
    // Unique event IDs also deduplicate webhook redeliveries after success.
    await prisma.lineLearningJob.createMany({
      data: inputs.map(jobData),
      skipDuplicates: true,
    });
  }

  async claim(userId: string): Promise<LineJob | null> {
    const prisma = getPrismaClient();
    const now = new Date();
    await prisma.lineLearningJob.updateMany({
      where: {
        userId,
        kind: { in: [...ACTIVE_LINE_JOB_KINDS] },
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
          kind: { in: [...ACTIVE_LINE_JOB_KINDS] },
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
    if (!isGenerated(job.kind)) return false;
    return getPrismaClient().$transaction(async (tx) => {
      const locked = await tx.lineLearningJob.updateMany({
        where: { ...leaseWhere(job), kind: job.kind },
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
          kind: draft.kind ?? "correction",
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
    // Only a failed correction or translation is answered with a saved reply.
    if (!isGenerated(job.kind) || !failureCode) return false;
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
    // Log the code, never the text.
    if (saved && failureCode)
      console.warn(
        JSON.stringify({
          event: "line_correction_failed",
          kind: job.kind,
          at: new Date().toISOString(),
          jobId: job.id,
          code: failureCode,
        }),
      );
    return saved;
  }

  async finishDelivery(job: LineJob) {
    await getPrismaClient().lineLearningJob.updateMany({
      where: leaseWhere(job),
      data: {
        status: "SENT",
        leaseToken: null,
        ...(isGenerated(job.kind) && job.replyText
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
        ...(isGenerated(job.kind) && job.replyText
          ? {}
          : { failureCode: code }),
        availableAt: new Date(Date.now() + 30_000 * 2 ** tries),
      },
    });
  }
}
