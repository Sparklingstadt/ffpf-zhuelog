// Password accounts, written with the statements Go's store used
// (services/api/store/accounts.go; stage 9 reference §4 and §8) so Go's
// sign-in, which stays until stage 11, keeps reading what the web writes.
//
// Every password change bumps "sessionVersion" in the same UPDATE as the
// hash. Go's Authenticate and Refresh and the web's TokenCurrentUserProvider
// compare it on every request, so that one statement revokes every existing
// session (Go's refresh also revokes the token family); the same transaction
// deletes the owner's Session rows (stage 11); ApiRefreshToken is left to Go
// until stage 12.
//
// A member's own change replaces the hash only while it is still the one the
// member's current password was verified against (compare-and-swap in the
// WHERE clause). That keeps an admin reset made during the ~0.1 s scrypt from
// being overwritten, without holding a transaction open across the hash.
// An admin reset is unconditional, as in Go.
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { MemberAccount } from "../../domain/identity/member-account";
import { newId } from "./new-id";
import { SESSION_TRANSACTION_OPTIONS } from "./session-store";

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

// Runs a setPasswordSql statement and, only when it changed the account,
// deletes the account's sessions in the same transaction, so no session
// outlives the password it was signed in with. The loginId, or null when no
// row changed.
async function updatePasswordEndingSessions(
  db: () => PrismaClient,
  id: string,
  statement: Prisma.Sql,
): Promise<string | null> {
  return db().$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ loginId: string }[]>(statement);
    if (rows.length !== 1) return null;
    await tx.session.deleteMany({ where: { ownerId: `password:${id}` } });
    return rows[0].loginId;
  }, SESSION_TRANSACTION_OPTIONS);
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
      return updatePasswordEndingSessions(
        db,
        id,
        setPasswordSql(id, passwordHash, now),
      );
    },

    // A member's own change. false: the account is gone or its hash is no
    // longer expectedHash.
    async replacePassword(
      id: string,
      expectedHash: string,
      passwordHash: string,
      now: Date,
    ): Promise<boolean> {
      const loginId = await updatePasswordEndingSessions(
        db,
        id,
        setPasswordSql(id, passwordHash, now, expectedHash),
      );
      return loginId !== null;
    },
  };
}
