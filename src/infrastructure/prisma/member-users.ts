import { Prisma } from "../../generated/prisma/client";

// Pure SQL fragment: "user" u is a member, i.e. neither an admin nor a guest
// (an anonymous user). role and isAnonymous are nullable in Better Auth's
// table, so a NULL reads as the default ("user", not anonymous).
export const IS_MEMBER_USER = Prisma.sql`coalesce(u."role", 'user') <> 'admin' AND NOT coalesce(u."isAnonymous", false)`;

// Pure: whether the user userId exists and is a member.
export function memberExistsSql(userId: string): Prisma.Sql {
  return Prisma.sql`SELECT EXISTS (SELECT 1 FROM "user" u WHERE u."id" = ${userId} AND ${IS_MEMBER_USER}) AS "member"`;
}
