import type { PrismaClient } from "../../generated/prisma/client";

// The where clause that deletes the owner's review items of the given notes.
// Only kind "entry": vocabulary cards share the table and must stay.
export function reviewItemsToDelete(userId: string, ids: string[]) {
  return { userId, kind: "entry" as const, targetId: { in: ids } };
}

// Interactive transaction limits for the purge writes. Prisma's default is a
// 5 s timeout, too short for a cold Neon start or a big trash.
export const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 };

// Every write names the owner and the note's state in its WHERE clause and is
// decided by the number of rows it affected, so a concurrent trash, restore or
// purge cannot slip between a check and the write. `now` is read once per call
// and kept to milliseconds, the precision of the TIMESTAMP(3) columns.
export function createLearningNoteWrites(
  db: () => PrismaClient,
  now: () => Date = () => new Date(),
) {
  const takeNow = () => new Date(Math.trunc(now().getTime()));

  return {
    // live -> trashed. False when it is not the owner's live note.
    async trash(userId: string, id: string): Promise<boolean> {
      const { count } = await db().learningEntry.updateMany({
        where: { id, userId, deletedAt: null },
        data: { deletedAt: takeNow() },
      });
      return count > 0;
    },

    // trashed -> live; sharedAt is left as it was.
    async restore(userId: string, id: string): Promise<boolean> {
      const { count } = await db().learningEntry.updateMany({
        where: { id, userId, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      return count > 0;
    },

    // Deletes a trashed note (hints and logs cascade) and its entry review
    // items, in one transaction. See TRANSACTION_OPTIONS for the limits.
    async purge(userId: string, id: string): Promise<boolean> {
      return db().$transaction(async (tx) => {
        const { count } = await tx.learningEntry.deleteMany({
          where: { id, userId, deletedAt: { not: null } },
        });
        if (count === 0) return false;
        await tx.reviewItem.deleteMany({
          where: reviewItemsToDelete(userId, [id]),
        });
        return true;
      }, TRANSACTION_OPTIONS);
    },

    // Deletes all the owner's trashed notes and their entry review items in
    // one transaction, using the ids the DELETE itself returned.
    async emptyTrash(userId: string): Promise<number> {
      return db().$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          DELETE FROM "LearningEntry"
           WHERE "userId" = ${userId} AND "deletedAt" IS NOT NULL
          RETURNING "id"`;
        if (rows.length === 0) return 0;
        await tx.reviewItem.deleteMany({
          where: reviewItemsToDelete(
            userId,
            rows.map((r) => r.id),
          ),
        });
        return rows.length;
      }, TRANSACTION_OPTIONS);
    },

    // Live notes only. Sharing keeps the first sharedAt; unsharing an
    // unshared note succeeds.
    async setShared(
      userId: string,
      id: string,
      shared: boolean,
    ): Promise<boolean> {
      if (!shared) {
        const { count } = await db().learningEntry.updateMany({
          where: { id, userId, deletedAt: null },
          data: { sharedAt: null },
        });
        return count > 0;
      }
      const at = takeNow();
      const count = await db().$executeRaw`
        UPDATE "LearningEntry" SET "sharedAt" = COALESCE("sharedAt", ${at})
         WHERE "id" = ${id} AND "userId" = ${userId} AND "deletedAt" IS NULL`;
      return count > 0;
    },
  };
}
