import type { PrismaClient } from "../../generated/prisma/client";

// The where clause that deletes the owner's review items of the given notes.
// Only kind "entry": vocabulary cards share the table and must stay.
export function reviewItemsToDelete(ownerId: string, ids: string[]) {
  return { ownerId, kind: "entry" as const, targetId: { in: ids } };
}

// Interactive transaction limits for the purge writes. Prisma's default is a
// 5 s timeout, too short for a cold Neon start or a big trash (Go allowed up
// to its 30 s server limit).
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 };

// Every write names the owner and the note's state in its WHERE clause and is
// decided by the number of rows it affected, so a concurrent trash, restore or
// purge cannot slip between a check and the write. `now` is read once per call
// and kept to milliseconds, as Go's dbTime does.
export function createLearningNoteWrites(
  db: () => PrismaClient,
  now: () => Date = () => new Date(),
) {
  const takeNow = () => new Date(Math.trunc(now().getTime()));

  return {
    // live -> trashed. False when it is not the owner's live note.
    async trash(ownerId: string, id: string): Promise<boolean> {
      const { count } = await db().learningEntry.updateMany({
        where: { id, ownerId, deletedAt: null },
        data: { deletedAt: takeNow() },
      });
      return count > 0;
    },

    // trashed -> live; sharedAt is left as it was.
    async restore(ownerId: string, id: string): Promise<boolean> {
      const { count } = await db().learningEntry.updateMany({
        where: { id, ownerId, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      return count > 0;
    },

    // Deletes a trashed note (hints and logs cascade) and its entry review
    // items, in one transaction. See TRANSACTION_OPTIONS for the limits.
    async purge(ownerId: string, id: string): Promise<boolean> {
      return db().$transaction(async (tx) => {
        const { count } = await tx.learningEntry.deleteMany({
          where: { id, ownerId, deletedAt: { not: null } },
        });
        if (count === 0) return false;
        await tx.reviewItem.deleteMany({
          where: reviewItemsToDelete(ownerId, [id]),
        });
        return true;
      }, TRANSACTION_OPTIONS);
    },

    // Deletes all the owner's trashed notes and their entry review items in
    // one transaction, using the ids the DELETE itself returned.
    async emptyTrash(ownerId: string): Promise<number> {
      return db().$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          DELETE FROM "LearningEntry"
           WHERE "ownerId" = ${ownerId} AND "deletedAt" IS NOT NULL
          RETURNING "id"`;
        if (rows.length === 0) return 0;
        await tx.reviewItem.deleteMany({
          where: reviewItemsToDelete(
            ownerId,
            rows.map((r) => r.id),
          ),
        });
        return rows.length;
      }, TRANSACTION_OPTIONS);
    },

    // Live notes only. Sharing keeps the first sharedAt; unsharing an
    // unshared note succeeds.
    async setShared(
      ownerId: string,
      id: string,
      shared: boolean,
    ): Promise<boolean> {
      if (!shared) {
        const { count } = await db().learningEntry.updateMany({
          where: { id, ownerId, deletedAt: null },
          data: { sharedAt: null },
        });
        return count > 0;
      }
      const at = takeNow();
      const count = await db().$executeRaw`
        UPDATE "LearningEntry" SET "sharedAt" = COALESCE("sharedAt", ${at})
         WHERE "id" = ${id} AND "ownerId" = ${ownerId} AND "deletedAt" IS NULL`;
      return count > 0;
    },
  };
}
