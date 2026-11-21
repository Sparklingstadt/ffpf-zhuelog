import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { LearningEntry } from "../../domain/learning/entities/learning-entry";
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

// The most items one due list may hold (Go's reviewDueMaxLimit).
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
// on restore; an item whose note or word no longer exists is still due (Go's
// notTrashedEntry). Prisma's query API cannot say NOT EXISTS over a table
// without a relation (the item has no foreign key to its target), so every
// due read is raw SQL built on this one condition.
function dueCondition(ownerId: string, now: Date): Prisma.Sql {
  return Prisma.sql`"ownerId" = ${ownerId} AND "due" <= ${now}
    AND NOT EXISTS (SELECT 1 FROM "LearningEntry" e
     WHERE "ReviewItem"."kind" = ${REVIEW_KIND_ENTRY}
       AND e."id" = "ReviewItem"."targetId"
       AND e."ownerId" = "ReviewItem"."ownerId"
       AND e."deletedAt" IS NOT NULL)`;
}

// Pure: the ReviewLog row for an answer, from the card as it stood, so the
// FSRS parameters can later be fitted to the owner's history.
export function reviewLogRow(input: {
  logId: string;
  ownerId: string;
  itemId: string;
  rating: number;
  before: FsrsCard;
  reviewedAt: Date;
}): {
  id: string;
  ownerId: string;
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
    ownerId: input.ownerId,
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

// Locks the owner's live note until the transaction ends; false when there is
// none. The note cannot be trashed (and so not purged) meanwhile, so no item
// is left behind by a write racing a purge (Go's lockOwnEntry).
async function lockOwnEntry(
  tx: Prisma.TransactionClient,
  ownerId: string,
  entryId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ one: number }[]>`
    SELECT 1 AS one FROM "LearningEntry"
     WHERE "id" = ${entryId} AND "ownerId" = ${ownerId}
       AND "deletedAt" IS NULL
       FOR SHARE`;
  return rows.length > 0;
}

// Reads and writes the owner's review queue the way the Go API's store did.
// Every query names the owner; `now` comes from the caller, read once per
// request.
export function createReviewStore(db: () => PrismaClient) {
  return {
    async countDue(ownerId: string, now: Date): Promise<number> {
      const [{ count }] = await db().$queryRaw<[{ count: bigint }]>`
        SELECT count(*) AS count FROM "ReviewItem"
         WHERE ${dueCondition(ownerId, now)}`;
      return Number(count);
    },

    // Kinds with nothing due are absent.
    async countDueByKind(
      ownerId: string,
      now: Date,
    ): Promise<Record<string, number>> {
      const rows = await db().$queryRaw<{ kind: string; count: bigint }[]>`
        SELECT "kind", count(*) AS count FROM "ReviewItem"
         WHERE ${dueCondition(ownerId, now)}
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
      ownerId: string,
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
             WHERE ${dueCondition(ownerId, now)}
             ORDER BY "due", "id"
             LIMIT ${limit}`;
          const targets = (kind: string) =>
            rows.filter((row) => row.kind === kind).map((row) => row.targetId);
          const wordIds = targets(REVIEW_KIND_VOCABULARY);
          const words =
            wordIds.length === 0
              ? []
              : await tx.vocabularyEntry.findMany({
                  where: { ownerId, id: { in: wordIds } },
                  select: { id: true, word: true, pinyin: true, meaning: true },
                });
          const wordById = new Map(words.map((word) => [word.id, word]));
          const notes = await liveEntriesById(
            tx,
            ownerId,
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
    async reviewedDates(ownerId: string, since: Date): Promise<string[]> {
      const rows = await db().$queryRaw<{ day: string }[]>`
        SELECT DISTINCT
               to_char(("reviewedAt" + interval '9 hours')::date, 'YYYY-MM-DD')
                 AS day
          FROM "ReviewLog"
         WHERE "ownerId" = ${ownerId} AND "reviewedAt" >= ${since}`;
      return rows.map((row) => row.day);
    },

    // Applies an answer rated `rating` at `now` to the owner's item and logs
    // it under logId, in one transaction. A retry with the same logId changes
    // nothing and succeeds. false: not the owner's item (or not an item id
    // at all), or logId already used for another item. An FsrsError from
    // the scheduler is thrown as it is.
    async answer(
      ownerId: string,
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
           WHERE "id" = ${itemId} AND "ownerId" = ${ownerId}
             FOR UPDATE`;
        if (!item) return false;
        const logged = await tx.reviewLog.findUnique({
          where: { id: logId },
          select: { itemId: true, ownerId: true },
        });
        if (logged) {
          return logged.itemId === itemId && logged.ownerId === ownerId;
        }
        const before = toCard(item);
        const next = nextFsrsCard(before, rating, now);
        await tx.reviewLog.create({
          data: reviewLogRow({
            logId,
            ownerId,
            itemId,
            rating,
            before,
            reviewedAt: now,
          }),
        });
        const { count } = await tx.reviewItem.updateMany({
          where: { id: itemId, ownerId },
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
            // Set here rather than left to @updatedAt, as Go did.
            updatedAt: now,
          },
        });
        return count > 0;
      }, TRANSACTION_OPTIONS);
    },

    // The ids of the owner's live notes in review; trashed notes are left
    // out.
    async entryIdsInReview(ownerId: string): Promise<Set<string>> {
      const rows = await db().$queryRaw<{ targetId: string }[]>`
        SELECT r."targetId" FROM "ReviewItem" r
          JOIN "LearningEntry" e
            ON e."id" = r."targetId" AND e."ownerId" = r."ownerId"
           AND e."deletedAt" IS NULL
         WHERE r."ownerId" = ${ownerId} AND r."kind" = ${REVIEW_KIND_ENTRY}`;
      return new Set(rows.map((row) => row.targetId));
    },

    // null: not the owner's live note.
    async isEntryInReview(
      ownerId: string,
      entryId: string,
    ): Promise<boolean | null> {
      const entry = await db().learningEntry.findFirst({
        where: { id: entryId, ownerId, deletedAt: null },
        select: { id: true },
      });
      if (!entry) return null;
      const count = await db().reviewItem.count({
        where: { ownerId, kind: REVIEW_KIND_ENTRY, targetId: entryId },
      });
      return count > 0;
    },

    // Puts the owner's live note in review as a new card due now; a note
    // already there keeps its card. false: not the owner's live note.
    async addEntry(
      ownerId: string,
      entryId: string,
      now: Date,
    ): Promise<boolean> {
      return db().$transaction(async (tx) => {
        if (!(await lockOwnEntry(tx, ownerId, entryId))) return false;
        await tx.reviewItem.createMany({
          data: [
            {
              id: newId(),
              ownerId,
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
    async removeEntry(ownerId: string, entryId: string): Promise<boolean> {
      return db().$transaction(async (tx) => {
        if (!(await lockOwnEntry(tx, ownerId, entryId))) return false;
        await tx.reviewItem.deleteMany({
          where: reviewItemsToDelete(ownerId, [entryId]),
        });
        return true;
      }, TRANSACTION_OPTIONS);
    },
  };
}

export type ReviewStore = ReturnType<typeof createReviewStore>;
