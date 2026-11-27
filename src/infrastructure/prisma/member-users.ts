import { Prisma } from "../../generated/prisma/client";

// Pure SQL fragment: "user" u is a member, i.e. neither an admin nor a guest
// (an anonymous user). role and isAnonymous are nullable in Better Auth's
// table, so a NULL reads as the default ("user", not anonymous).
export const IS_MEMBER_USER = Prisma.sql`coalesce(u."role", 'user') <> 'admin' AND NOT coalesce(u."isAnonymous", false)`;

// Pure: whether the user userId exists and may use LINE: a member or an
// admin (not a guest) who is not banned.
export function lineOwnerExistsSql(userId: string): Prisma.Sql {
  return Prisma.sql`SELECT EXISTS (SELECT 1 FROM "user" u WHERE u."id" = ${userId} AND NOT coalesce(u."isAnonymous", false) AND NOT coalesce(u."banned", false)) AS "found"`;
}
