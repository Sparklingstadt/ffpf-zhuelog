// Password accounts, written with the statements Go's store used
// (services/api/store/accounts.go; stage 9 reference §4 and §8) so Go's
// sign-in, which stays until stage 11, keeps reading what the web writes.
//
// Every password change bumps "sessionVersion" in the same UPDATE as the
// hash. Go's Authenticate and Refresh and the web's TokenCurrentUserProvider
// compare it on every request, so that one statement revokes every existing
// session (Go's refresh also revokes the token family); nothing touches
// ApiRefreshToken.
//
// A member's own change replaces the hash only while it is still the one the
// member's current password was verified against (compare-and-swap in the
// WHERE clause). That keeps an admin reset made during the ~0.1 s scrypt from
// being overwritten, without holding a transaction open across the hash.
// An admin reset is unconditional, as in Go.
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { MemberAccount } from "../../domain/identity/member-account";
import { newId } from "./new-id";

type AccountRow = {
  id: string;
  loginId: string;
  displayName: string;
  createdAt: Date;
};

function toMemberAccount(row: AccountRow): MemberAccount {
  return {
    id: row.id,
    ownerId: `password:${row.id}`,
    loginId: row.loginId,
    displayName: row.displayName,
    createdAt: row.createdAt,
  };
}

// Go's CreatePasswordAccount, with a taken loginId answering no row instead
// of a unique violation.
export function createPasswordAccountSql(
  id: string,
  input: { loginId: string; displayName: string; passwordHash: string },
  now: Date,
): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO "PasswordAccount" ("id", "loginId", "displayName", "passwordHash", "sessionVersion", "createdAt", "updatedAt")
    VALUES (${id}, ${input.loginId}, ${input.displayName}, ${input.passwordHash}, 0, CAST(${now} AS TIMESTAMP(3)), CAST(${now} AS TIMESTAMP(3)))
    ON CONFLICT ("loginId") DO NOTHING
    RETURNING "id", "loginId", "displayName", "createdAt"`;
}

// Go's SetPassword: the hash and the session version in one statement,
// returning the loginId. With expectedHash, only while the stored hash is
// still that one.
export function setPasswordSql(
  id: string,
  passwordHash: string,
  now: Date,
  expectedHash?: string,
): Prisma.Sql {
  const guard =
    expectedHash === undefined
      ? Prisma.empty
      : Prisma.sql`AND "passwordHash" = ${expectedHash}`;
  return Prisma.sql`
    UPDATE "PasswordAccount" SET
      "passwordHash" = ${passwordHash},
      "sessionVersion" = "sessionVersion" + 1,
      "updatedAt" = CAST(${now} AS TIMESTAMP(3))
    WHERE "id" = ${id}
      ${guard}
    RETURNING "loginId"`;
}

export function createPasswordAccountStore(
  db: () => PrismaClient,
  newAccountId: () => string = newId,
) {
  return {
    // Every password account (the demo's too), oldest first (createdAt, id).
    async list(): Promise<MemberAccount[]> {
      const rows = await db().passwordAccount.findMany({
        select: { id: true, loginId: true, displayName: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return rows.map(toMemberAccount);
    },

    // null: the loginId is taken.
    async create(
      input: { loginId: string; displayName: string; passwordHash: string },
      now: Date,
    ): Promise<MemberAccount | null> {
      const rows = await db().$queryRaw<AccountRow[]>(
        createPasswordAccountSql(newAccountId(), input, now),
      );
      return rows.length === 0 ? null : toMemberAccount(rows[0]);
    },

    async loginIdOf(id: string): Promise<string | null> {
      const row = await db().passwordAccount.findUnique({
        where: { id },
        select: { loginId: true },
      });
      return row?.loginId ?? null;
    },

    async credentials(
      id: string,
    ): Promise<{ id: string; passwordHash: string } | null> {
      return db().passwordAccount.findUnique({
        where: { id },
        select: { id: true, passwordHash: true },
      });
    },

    // An admin's reset. The loginId, or null when no account has the id.
    async setPassword(
      id: string,
      passwordHash: string,
      now: Date,
    ): Promise<string | null> {
      const rows = await db().$queryRaw<{ loginId: string }[]>(
        setPasswordSql(id, passwordHash, now),
      );
      return rows[0]?.loginId ?? null;
    },

    // A member's own change. false: the account is gone or its hash is no
    // longer expectedHash.
    async replacePassword(
      id: string,
      expectedHash: string,
      passwordHash: string,
      now: Date,
    ): Promise<boolean> {
      const rows = await db().$queryRaw<{ loginId: string }[]>(
        setPasswordSql(id, passwordHash, now, expectedHash),
      );
      return rows.length === 1;
    },
  };
}
