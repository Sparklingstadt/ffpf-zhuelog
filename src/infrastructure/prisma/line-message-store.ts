// LineMessage: the texts the LINE bot accepted for correction or
// translation. One row per webhookEventId, statuses pending/done/failed, at
// most LINE_MAX_ATTEMPTS attempts, and the text cleared once done or failed.
// The webhook and the drain may work on the same row, so each write names the
// state it expects and is decided by the rows it changed.
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import {
  LINE_MAX_ATTEMPTS,
  LINE_RETENTION_MS,
  type LineMessage,
  type LineMessageStatus,
} from "../../domain/line/line-message";
import type { LineGeneration } from "../../domain/line/line-replies";
import type { LineLearningKind } from "../../domain/line/line-text";
import { LINE_TRANSACTION_OPTIONS } from "./line-link-store";
import { newId } from "./new-id";

type NewLineMessage = {
  webhookEventId: string;
  lineUserId: string;
  ownerId: string;
  kind: LineLearningKind;
  text: string;
};

// The columns every raw statement returns; a cleared text reads as "".
const COLUMNS = Prisma.sql`"id", "webhookEventId", "lineUserId", "ownerId", "kind", COALESCE("text", '') AS "text", "status", "attempts", "createdAt"`;

// Pure: inserts a pending message. A second delivery of the same event
// returns no row.
export function insertLineMessageSql(
  id: string,
  message: NewLineMessage,
  now: Date,
): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO "LineMessage" ("id", "webhookEventId", "lineUserId", "ownerId", "kind", "text", "status", "attempts", "createdAt", "updatedAt")
    VALUES (${id}, ${message.webhookEventId}, ${message.lineUserId}, ${message.ownerId}, ${message.kind}, ${message.text}, 'pending', 0, CAST(${now} AS TIMESTAMP(3)), CAST(${now} AS TIMESTAMP(3)))
    ON CONFLICT ("webhookEventId") DO NOTHING
    RETURNING ${COLUMNS}`;
}

// Pure: counts one attempt on a pending message. One conditional UPDATE, so
// two passes cannot both take the last attempt.
export function startAttemptSql(id: string, now: Date): Prisma.Sql {
  return Prisma.sql`
    UPDATE "LineMessage" SET "attempts" = "attempts" + 1, "updatedAt" = CAST(${now} AS TIMESTAMP(3))
     WHERE "id" = ${id} AND "status" = 'pending' AND "attempts" < ${LINE_MAX_ATTEMPTS}
    RETURNING ${COLUMNS}`;
}

// Thrown inside complete's transaction to roll the note back.
class NotPendingError extends Error {
  constructor() {
    super("line message is not pending");
    this.name = "NotPendingError";
  }
}

// A row as Prisma reads it. kind and status are kept to their values by the
// table's CHECKs.
type LineMessageRow = {
  id: string;
  webhookEventId: string;
  lineUserId: string;
  ownerId: string;
  kind: string;
  text: string | null;
  status: string;
  attempts: number;
  createdAt: Date;
};

function toLineMessage(row: LineMessageRow): LineMessage {
  return {
    id: row.id,
    webhookEventId: row.webhookEventId,
    lineUserId: row.lineUserId,
    ownerId: row.ownerId,
    kind: row.kind as LineLearningKind,
    text: row.text ?? "",
    status: row.status as LineMessageStatus,
    attempts: row.attempts,
    createdAt: row.createdAt,
  };
}

// Callers read `now` once and pass it truncated to milliseconds: the columns
// are TIMESTAMP(3).
export function createLineMessageStore(
  db: () => PrismaClient,
  newRowId: () => string = newId,
) {
  return {
    // Stores an accepted text. created false: the event was delivered before;
    // the stored row comes back. The two statements need no transaction: ON
    // CONFLICT DO NOTHING waits for a concurrent insert of the same event to
    // commit, and the next statement (READ COMMITTED) sees that row.
    async insert(
      message: NewLineMessage,
      now: Date,
    ): Promise<{ message: LineMessage; created: boolean }> {
      const rows = await db().$queryRaw<LineMessageRow[]>(
        insertLineMessageSql(newRowId(), message, now),
      );
      if (rows.length > 0) {
        return { message: toLineMessage(rows[0]), created: true };
      }
      const stored = await db().lineMessage.findUnique({
        where: { webhookEventId: message.webhookEventId },
      });
      if (!stored) throw new Error("line message vanished after a conflict");
      return { message: toLineMessage(stored), created: false };
    },

    // Starts an attempt. null: unknown, no longer pending, or out of attempts.
    async startAttempt(id: string, now: Date): Promise<LineMessage | null> {
      const rows = await db().$queryRaw<LineMessageRow[]>(
        startAttemptSql(id, now),
      );
      return rows.length > 0 ? toLineMessage(rows[0]) : null;
    },

    // Saves the note (in its own import batch, named "LINE") and marks the
    // message done, in one transaction. false (nothing saved): not the
    // owner's pending message.
    async complete(
      id: string,
      ownerId: string,
      note: {
        kind: LineLearningKind;
        originalText: string;
        generation: LineGeneration;
      },
      now: Date,
    ): Promise<boolean> {
      try {
        await db().$transaction(async (tx) => {
          const batchId = newRowId();
          await tx.importBatch.create({
            data: {
              id: batchId,
              fileName: "LINE",
              rowCount: 1,
              importedAt: now,
            },
          });
          const entryId = newRowId();
          await tx.learningEntry.create({
            data: {
              id: entryId,
              kind: note.kind,
              originalText: note.originalText,
              correctedText: note.generation.text,
              pinyin: note.generation.pinyin,
              createdAt: now,
              ownerId,
              batchId,
            },
          });
          if (note.generation.hints.length > 0) {
            await tx.hint.createMany({
              data: note.generation.hints.map((content, position) => ({
                id: newRowId(),
                content,
                position,
                learningEntryId: entryId,
              })),
            });
          }
          const { count } = await tx.lineMessage.updateMany({
            where: { id, ownerId, status: "pending" },
            data: { status: "done", entryId, text: null, updatedAt: now },
          });
          if (count === 0) throw new NotPendingError();
        }, LINE_TRANSACTION_OPTIONS);
        return true;
      } catch (error) {
        if (error instanceof NotPendingError) return false;
        throw error;
      }
    },

    // Marks a pending message failed and clears its text.
    async fail(id: string, now: Date): Promise<void> {
      await db().lineMessage.updateMany({
        where: { id, status: "pending" },
        data: { status: "failed", text: null, updatedAt: now },
      });
    },

    // Pending messages created before createdBefore, oldest first.
    async listStale(
      createdBefore: Date,
      limit: number,
    ): Promise<LineMessage[]> {
      const rows = await db().lineMessage.findMany({
        where: { status: "pending", createdAt: { lt: createdBefore } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit,
      });
      return rows.map(toLineMessage);
    },

    // Deletes done and failed messages older than 7 days, and expired codes.
    async prune(now: Date): Promise<void> {
      await db().lineMessage.deleteMany({
        where: {
          status: { in: ["done", "failed"] },
          updatedAt: { lt: new Date(now.getTime() - LINE_RETENTION_MS) },
        },
      });
      await db().lineLinkCode.deleteMany({
        where: { expiresAt: { lte: now } },
      });
    },
  };
}
