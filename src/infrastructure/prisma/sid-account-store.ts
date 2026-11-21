// Sparklingstadt ID accounts, written with one upsert statement.
import { Prisma, type PrismaClient } from "../../generated/prisma/client";

type SidAccountInput = { id: string; email: string; displayName: string };

// The upsert is one statement: a new
// account starts at sessionVersion 0; a known one gets the new email,
// displayName, lastLoginAt and updatedAt and keeps sessionVersion and
// createdAt.
export function upsertSidAccountSql(
  input: SidAccountInput,
  now: Date,
): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO "SidAccount" ("id", "email", "displayName", "sessionVersion", "createdAt", "updatedAt", "lastLoginAt")
    VALUES (${input.id}, ${input.email}, ${input.displayName}, 0, CAST(${now} AS TIMESTAMP(3)), CAST(${now} AS TIMESTAMP(3)), CAST(${now} AS TIMESTAMP(3)))
    ON CONFLICT ("id") DO UPDATE SET "email" = EXCLUDED."email", "displayName" = EXCLUDED."displayName", "lastLoginAt" = EXCLUDED."lastLoginAt", "updatedAt" = EXCLUDED."updatedAt"
    RETURNING "sessionVersion"`;
}

export function createSidAccountStore(db: () => PrismaClient) {
  return {
    async upsert(
      input: SidAccountInput,
      now: Date,
    ): Promise<{ sessionVersion: number }> {
      const rows = await db().$queryRaw<{ sessionVersion: number }[]>(
        upsertSidAccountSql(input, now),
      );
      const row = rows[0];
      // INSERT … ON CONFLICT DO UPDATE … RETURNING always returns the row.
      if (!row) throw new Error("SID_ACCOUNT_UPSERT_RETURNED_NO_ROW");
      return { sessionVersion: row.sessionVersion };
    },
  };
}
