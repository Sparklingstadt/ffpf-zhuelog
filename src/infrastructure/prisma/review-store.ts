import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { LearningEntry } from "../../domain/learning/entities/learning-entry";
import type { PracticeReviewTarget } from "../../domain/practice/practice-round";
import { nextFsrsCard, type FsrsCard } from "../../domain/review/fsrs";
import { REVIEW_ITEM_ID } from "../../domain/review/review-item";
import type { VocabularyCard } from "../../domain/vocabulary/vocabulary-entry";
import { liveEntriesById } from "./learning-note-reads";
import {
  TRANSACTION_OPTIONS,
  reviewItemsToDelete,
} from "./learning-note-writes";
import { newId } from "./new-id";

export { REVIEW_ITEM_ID };

// The language of a note's review item: notes are Chinese.
const LANGUAGE = "zh";
const REVIEW_KIND_ENTRY = "entry";
const REVIEW_KIND_VOCABULARY = "vocabulary";

// The most items one due list may hold.
const MAX_DUE_LIMIT = 100;

export type StoredReviewItem = {
  id: string;
  language: string;
  kind: string;
  targetId: string;
  card: FsrsCard;
  vocabulary: VocabularyCard | null; // kind "vocabulary" with its word
  entry: LearningEntry | null; // kind "entry" with its live note
};

type ItemRow = {
  id: string;
  language: string;
  kind: string;
  targetId: string;
  due: Date;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: number;
  remainingSteps: number;
  lastReview: Date | null;
};

const ITEM_COLUMNS = Prisma.sql`"id", "language", "kind", "targetId", "due",
  "stability", "difficulty", "scheduledDays", "reps", "lapses", "state",
  "remainingSteps", "lastReview"`;

function toCard(row: ItemRow): FsrsCard {
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    scheduledDays: row.scheduledDays,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    remainingSteps: row.remainingSteps,
    lastReview: row.lastReview,
  };
}

// The owner's items due at or before now, on the alias-less "ReviewItem".
// An "entry" item is left out while its note is in the trash and comes back
// on restore; an item whose note or word no longer exists is still due.
// Prisma's query API cannot say NOT EXISTS over a table without a relation
// (the item has no foreign key to its target), so every due read is raw SQL
// built on this one condition.
function dueCondition(userId: string, now: Date): Prisma.Sql {
  return Prisma.sql`"userId" = ${userId} AND "due" <= ${now}
    AND NOT EXISTS (SELECT 1 FROM "LearningEntry" e
     WHERE "ReviewItem"."kind" = ${REVIEW_KIND_ENTRY}
       AND e."id" = "ReviewItem"."targetId"
       AND e."userId" = "ReviewItem"."userId"
       AND e."deletedAt" IS NOT NULL)`;
}

// Pure: the ReviewLog row for an answer, from the card as it stood, so the
// FSRS parameters can later be fitted to the owner's history.
export function reviewLogRow(input: {
  logId: string;
  userId: string;
  itemId: string;
  rating: number;
  before: FsrsCard;
  reviewedAt: Date;
}): {
  id: string;
  userId: string;
  itemId: string;
  rating: number;
  state: number;
  due: Date;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  reviewedAt: Date;
} {
  const { before } = input;
  return {
    id: input.logId,
    userId: input.userId,
    itemId: input.itemId,
    rating: input.rating,
    state: before.state,
    due: before.due,
    stability: before.stability,
    difficulty: before.difficulty,
    scheduledDays: before.scheduledDays,
    reviewedAt: input.reviewedAt,
  };
}

// The one statement that puts a whole round's practice mistakes in the
// owner's queue at now: a new target becomes a New card due now; a target
// due later is brought forward to now with its FSRS columns kept; a target
// already due is left as it is, updatedAt included. null when there are no
// targets.
//
// Prisma's upsert cannot put a WHERE on its update, so this is raw SQL. It
// must stay one INSERT … ON CONFLICT DO UPDATE rather than a read and a
// write: answering takes the item with FOR UPDATE and rewrites every FSRS
// column, and ON CONFLICT DO UPDATE waits on that lock and then checks its
// WHERE against the committed row, so neither write is lost.
//
// One statement cannot touch the same row twice, so the targets must be
// distinct; they are also sorted, so two saves of the same targets lock the
// rows in the same order. practiceReviewTargets does both. Every value is a
// bound parameter: 9 per target, so the largest round (50 questions) binds
// 450, far below Postgres's 65,535.
export function enqueueReviewItemsSql(
  userId: string,
  targets: readonly PracticeReviewTarget[],
  now: Date,
  newItemId: () => string = newId,
): Prisma.Sql | null {
  if (targets.length === 0) return null;
  const rows = targets.map(
    (target) =>
      Prisma.sql`(${newItemId()}, ${userId}, ${target.language}, ${target.kind}, ${target.targetId}, ${now}, ${0}, ${now}, ${now})`,
  );
  return Prisma.sql`
    INSERT INTO "ReviewItem" ("id", "userId", "language", "kind", "targetId", "due", "state", "createdAt", "updatedAt")
    VALUES ${Prisma.join(rows)}
    ON CONFLICT ("userId", "language", "kind", "targetId") DO UPDATE
    SET "due" = EXCLUDED."due", "updatedAt" = EXCLUDED."updatedAt"
    WHERE "ReviewItem"."due" > EXCLUDED."due"`;
}

// Runs enqueueReviewItemsSql in the caller's transaction; the number of
// items added or brought forward.
export async function enqueueReviewItems(
  tx: Prisma.TransactionClient,
  userId: string,
  targets: readonly PracticeReviewTarget[],
  now: Date,
): Promise<number> {
  const sql = enqueueReviewItemsSql(userId, targets, now);
  if (sql === null) return 0;
  return tx.$executeRaw(sql);
}

// Locks the owner's live note until the transaction ends; false when there is
// none. The note cannot be trashed (and so not purged) meanwhile, so no item
// is left behind by a write racing a purge.
async function lockOwnEntry(
  tx: Prisma.TransactionClient,
  userId: string,
  entryId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ one: number }[]>`
    SELECT 1 AS one FROM "LearningEntry"
     WHERE "id" = ${entryId} AND "userId" = ${userId}
       AND "deletedAt" IS NULL
       FOR SHARE`;
  return rows.length > 0;
}

// Reads and writes the owner's review queue. Every query names the owner;
// `now` comes from the caller, read once per request.
export function createReviewStore(db: () => PrismaClient) {
  return {
    async countDue(userId: string, now: Date): Promise<number> {
      const [{ count }] = await db().$queryRaw<[{ count: bigint }]>`
        SELECT count(*) AS count FROM "ReviewItem"
         WHERE ${dueCondition(userId, now)}`;
      return Number(count);
    },

    // Kinds with nothing due are absent.
    async countDueByKind(
      userId: string,
      now: Date,
    ): Promise<Record<string, number>> {
      const rows = await db().$queryRaw<{ kind: string; count: bigint }[]>`
        SELECT "kind", count(*) AS count FROM "ReviewItem"
         WHERE ${dueCondition(userId, now)}
         GROUP BY "kind"`;
      return Object.fromEntries(
        rows.map(({ kind, count }) => [kind, Number(count)]),
      );
    },

    // Up to limit (1..100) due items, the longest overdue first, each
    // "vocabulary" item with its word and "entry" item with its live note
    // when they still exist. One repeatable-read snapshot, so a note trashed
    // meanwhile is either left out or comes with its note. (Prisma has no
    // read-only transaction option; nothing here writes.)
    async listDue(
      userId: string,
      now: Date,
      limit: number,
    ): Promise<StoredReviewItem[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DUE_LIMIT) {
        throw new RangeError("the due list limit must be 1 to 100");
      }
      return db().$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<ItemRow[]>`
            SELECT ${ITEM_COLUMNS} FROM "ReviewItem"
             WHERE ${dueCondition(userId, now)}
             ORDER BY "due", "id"
             LIMIT ${limit}`;
          const targets = (kind: string) =>
            rows.filter((row) => row.kind === kind).map((row) => row.targetId);
          const wordIds = targets(REVIEW_KIND_VOCABULARY);
          const words =
            wordIds.length === 0
              ? []
              : await tx.vocabularyEntry.findMany({
                  where: { userId, id: { in: wordIds } },
                  select: { id: true, word: true, pinyin: true, meaning: true },
                });
          const wordById = new Map(words.map((word) => [word.id, word]));
          const notes = await liveEntriesById(
            tx,
            userId,
            targets(REVIEW_KIND_ENTRY),
          );
          return rows.map((row) => ({
            id: row.id,
            language: row.language,
            kind: row.kind,
            targetId: row.targetId,
            card: toCard(row),
            vocabulary:
              row.kind === REVIEW_KIND_VOCABULARY
                ? (wordById.get(row.targetId) ?? null)
                : null,
            entry:
              row.kind === REVIEW_KIND_ENTRY
                ? (notes.get(row.targetId) ?? null)
                : null,
          }));
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          ...TRANSACTION_OPTIONS,
        },
      );
    },

    // Distinct Japan dates of the owner's answers at or after `since`. The
    // column holds UTC without a time zone, so 9 hours are added rather than
    // AT TIME ZONE.
    async reviewedDates(userId: string, since: Date): Promise<string[]> {
      const rows = await db().$queryRaw<{ day: string }[]>`
        SELECT DISTINCT
               to_char(("reviewedAt" + interval '9 hours')::date, 'YYYY-MM-DD')
                 AS day
          FROM "ReviewLog"
         WHERE "userId" = ${userId} AND "reviewedAt" >= ${since}`;
      return rows.map((row) => row.day);
    },

    // Applies an answer rated `rating` at `now` to the owner's item and logs
    // it under logId, in one transaction. A retry with the same logId changes
    // nothing and succeeds. false: not the owner's item (or not an item id
    // at all), or logId already used for another item. An FsrsError from
    // the scheduler is thrown as it is.
    async answer(
      userId: string,
      itemId: string,
      logId: string,
      rating: number,
      now: Date,
    ): Promise<boolean> {
      if (!REVIEW_ITEM_ID.test(itemId)) return false;
      return db().$transaction(async (tx) => {
        // The row lock makes concurrent answers to one item, retries
        // included, take turns.
        const [item] = await tx.$queryRaw<ItemRow[]>`
          SELECT ${ITEM_COLUMNS} FROM "ReviewItem"
           WHERE "id" = ${itemId} AND "userId" = ${userId}
             FOR UPDATE`;
        if (!item) return false;
        const logged = await tx.reviewLog.findUnique({
          where: { id: logId },
          select: { itemId: true, userId: true },
        });
        if (logged) {
          return logged.itemId === itemId && logged.userId === userId;
        }
        const before = toCard(item);
        const next = nextFsrsCard(before, rating, now);
        await tx.reviewLog.create({
          data: reviewLogRow({
            logId,
            userId,
            itemId,
            rating,
            before,
            reviewedAt: now,
          }),
        });
        const { count } = await tx.reviewItem.updateMany({
          where: { id: itemId, userId },
          data: {
            due: next.due,
            stability: next.stability,
            difficulty: next.difficulty,
            scheduledDays: next.scheduledDays,
            reps: next.reps,
            lapses: next.lapses,
            state: next.state,
            remainingSteps: next.remainingSteps,
            lastReview: next.lastReview,
            // Set to the answer's `now` rather than left to @updatedAt.
            updatedAt: now,
          },
        });
        return count > 0;
      }, TRANSACTION_OPTIONS);
    },

    // The ids of the owner's live notes in review; trashed notes are left
    // out.
    async entryIdsInReview(userId: string): Promise<Set<string>> {
      const rows = await db().$queryRaw<{ targetId: string }[]>`
        SELECT r."targetId" FROM "ReviewItem" r
          JOIN "LearningEntry" e
            ON e."id" = r."targetId" AND e."userId" = r."userId"
           AND e."deletedAt" IS NULL
         WHERE r."userId" = ${userId} AND r."kind" = ${REVIEW_KIND_ENTRY}`;
      return new Set(rows.map((row) => row.targetId));
    },

    // null: not the owner's live note.
    async isEntryInReview(
      userId: string,
      entryId: string,
    ): Promise<boolean | null> {
      const entry = await db().learningEntry.findFirst({
        where: { id: entryId, userId, deletedAt: null },
        select: { id: true },
      });
      if (!entry) return null;
      const count = await db().reviewItem.count({
        where: { userId, kind: REVIEW_KIND_ENTRY, targetId: entryId },
      });
      return count > 0;
    },

    // Puts the owner's live note in review as a new card due now; a note
    // already there keeps its card. false: not the owner's live note.
    async addEntry(
      userId: string,
      entryId: string,
      now: Date,
    ): Promise<boolean> {
      return db().$transaction(async (tx) => {
        if (!(await lockOwnEntry(tx, userId, entryId))) return false;
        await tx.reviewItem.createMany({
          data: [
            {
              id: newId(),
              userId,
              language: LANGUAGE,
              kind: REVIEW_KIND_ENTRY,
              targetId: entryId,
              due: now,
              state: 0,
              createdAt: now,
              updatedAt: now,
            },
          ],
          skipDuplicates: true,
        });
        return true;
      }, TRANSACTION_OPTIONS);
    },

    // Takes the owner's live note out of review; its card's log goes with it
    // through the schema's cascade. A note not in review succeeds too.
    // false: not the owner's live note.
    async removeEntry(userId: string, entryId: string): Promise<boolean> {
      return db().$transaction(async (tx) => {
        if (!(await lockOwnEntry(tx, userId, entryId))) return false;
        await tx.reviewItem.deleteMany({
          where: reviewItemsToDelete(userId, [entryId]),
        });
        return true;
      }, TRANSACTION_OPTIONS);
    },
  };
}

export type ReviewStore = ReturnType<typeof createReviewStore>;
