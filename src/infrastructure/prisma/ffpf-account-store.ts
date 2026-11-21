// FFPF ID accounts, written with Go's statement (services/api/store/
// ffpf_accounts.go), so the rows Go's sign-in wrote before stage 11 read
// the same way.
import { Prisma, type PrismaClient } from "../../generated/prisma/client";

type FfpfAccountInput = { id: string; email: string; displayName: string };

// Go's UpsertFfpfAccount (store/ffpf_accounts.go:25-41), one statement: a new
// account starts at sessionVersion 0; a known one gets the new email,
// displayName, lastLoginAt and updatedAt and keeps sessionVersion and
// createdAt.
export function upsertFfpfAccountSql(
  input: FfpfAccountInput,
  now: Date,
): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO "FfpfAccount" ("id", "email", "displayName", "sessionVersion", "createdAt", "updatedAt", "lastLoginAt")
    VALUES (${input.id}, ${input.email}, ${input.displayName}, 0, CAST(${now} AS TIMESTAMP(3)), CAST(${now} AS TIMESTAMP(3)), CAST(${now} AS TIMESTAMP(3)))
    ON CONFLICT ("id") DO UPDATE SET "email" = EXCLUDED."email", "displayName" = EXCLUDED."displayName", "lastLoginAt" = EXCLUDED."lastLoginAt", "updatedAt" = EXCLUDED."updatedAt"
    RETURNING "sessionVersion"`;
}

export function createFfpfAccountStore(db: () => PrismaClient) {
  return {
    async upsert(
      input: FfpfAccountInput,
      now: Date,
    ): Promise<{ sessionVersion: number }> {
      const rows = await db().$queryRaw<{ sessionVersion: number }[]>(
        upsertFfpfAccountSql(input, now),
      );
      const row = rows[0];
      // INSERT … ON CONFLICT DO UPDATE … RETURNING always returns the row.
      if (!row) throw new Error("FFPF_ACCOUNT_UPSERT_RETURNED_NO_ROW");
      return { sessionVersion: row.sessionVersion };
    },
  };
}
