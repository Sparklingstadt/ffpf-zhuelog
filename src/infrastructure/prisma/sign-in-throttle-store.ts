// Attempt counts in SignInThrottle. Each attempt runs two statements: one
// deletes a batch of dead rows, the other counts the attempt under its key.
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { ThrottleRule } from "../../domain/identity/sign-in-throttle";

// How many dead rows one attempt deletes.
export const THROTTLE_PRUNE_BATCH = 100;

// Deletes a batch of dead rows. SKIP LOCKED: concurrent attempts never wait
// on, or deadlock over, each other's cleanup.
export function pruneThrottleSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    DELETE FROM "SignInThrottle" WHERE "key" IN (
      SELECT "key" FROM "SignInThrottle"
       WHERE "expiresAt" <= CAST(${now} AS TIMESTAMP(3))
       LIMIT ${THROTTLE_PRUNE_BATCH} FOR UPDATE SKIP LOCKED)`;
}

// Counts one attempt in one statement, so concurrent attempts cannot read
// the same count. The first attempt, or the first after the window ended,
// starts a new window ending at expiresAt.
export function consumeThrottleSql(
  key: string,
  now: Date,
  expiresAt: Date,
): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO "SignInThrottle" ("key", "count", "expiresAt")
    VALUES (${key}, 1, CAST(${expiresAt} AS TIMESTAMP(3)))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "SignInThrottle"."expiresAt" <= CAST(${now} AS TIMESTAMP(3)) THEN 1 ELSE "SignInThrottle"."count" + 1 END,
      "expiresAt" = CASE WHEN "SignInThrottle"."expiresAt" <= CAST(${now} AS TIMESTAMP(3)) THEN CAST(${expiresAt} AS TIMESTAMP(3)) ELSE "SignInThrottle"."expiresAt" END
    RETURNING "count"`;
}

export function createSignInThrottleStore(db: () => PrismaClient) {
  return {
    // Counts one attempt; true while the count is within rule.limit.
    async consume(
      key: string,
      rule: ThrottleRule,
      now: Date,
    ): Promise<boolean> {
      await db().$executeRaw(pruneThrottleSql(now));
      const expiresAt = new Date(now.getTime() + rule.windowMs);
      const rows = await db().$queryRaw<{ count: number | bigint }[]>(
        consumeThrottleSql(key, now, expiresAt),
      );
      return Number(rows[0].count) <= rule.limit;
    },

    // Forgets the key's attempts (after a successful change).
    async reset(key: string): Promise<void> {
      await db().signInThrottle.deleteMany({ where: { key } });
    },
  };
}
