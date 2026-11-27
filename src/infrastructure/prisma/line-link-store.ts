// LineLink and LineLinkCode: which LINE account is linked to which user,
// the one-time codes that link them, and the setting the morning review
// message reads. The code is stored by its hash, there is one code and one
// link per user, and the review message is claimed once per JST day. The
// role of a link is its user's ("user"."role"): "admin", or "member" for
// anything else.
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type {
  LineLink,
  ReviewNotifyTarget,
} from "../../domain/line/line-message";
import { japanDate } from "../../domain/review/review-days";
import { lineOwnerExistsSql } from "./member-users";

// Interactive transaction limits for the LINE writes; Prisma's 5 s default is
// too short for a cold Neon start.
export const LINE_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 };

// A user's role as the LINE side reads it: "admin" or "member".
export function lineRole(role: string | null): "admin" | "member" {
  return role === "admin" ? "admin" : "member";
}

// Pure SQL fragment: lineRole of "user" u.
const LINE_ROLE = Prisma.sql`CASE WHEN u."role" = 'admin' THEN 'admin' ELSE 'member' END`;

// Pure: replaces the user's previous code.
export function putLinkCodeSql(
  userId: string,
  codeHash: string,
  expiresAt: Date,
): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO "LineLinkCode" ("codeHash", "userId", "expiresAt")
    VALUES (${codeHash}, ${userId}, CAST(${expiresAt} AS TIMESTAMP(3)))
    ON CONFLICT ("userId") DO UPDATE SET
      "codeHash" = EXCLUDED."codeHash", "expiresAt" = EXCLUDED."expiresAt"`;
}

// Pure: the links that want the review message, have not had today's and
// have reviews due, oldest link first. Every kind and language counts; notes
// in the trash do not. japanDay is now's JST date (YYYY-MM-DD).
export function reviewNotifyTargetsSql(
  now: Date,
  japanDay: string,
  limit: number,
): Prisma.Sql {
  return Prisma.sql`
    SELECT l."lineUserId", l."userId", ${LINE_ROLE} AS "role", d."due"
      FROM "LineLink" l
      JOIN "user" u ON u."id" = l."userId"
     CROSS JOIN LATERAL (
       SELECT count(*) AS "due" FROM "ReviewItem"
        WHERE "ReviewItem"."userId" = l."userId" AND "ReviewItem"."due" <= CAST(${now} AS TIMESTAMP(3))
          AND NOT EXISTS (SELECT 1 FROM "LearningEntry" e
                WHERE "ReviewItem"."kind" = 'entry' AND e."id" = "ReviewItem"."targetId"
                  AND e."userId" = "ReviewItem"."userId" AND e."deletedAt" IS NOT NULL)
     ) d
     WHERE l."reviewNotify" AND (l."reviewNotifiedOn" IS NULL OR l."reviewNotifiedOn" < CAST(${japanDay} AS DATE)) AND d."due" > 0
     ORDER BY l."createdAt", l."lineUserId"
     LIMIT ${limit}`;
}

// Pure: claims today's review message for the link. One conditional UPDATE,
// so two passes on the same day cannot both claim.
export function claimReviewNotifySql(
  lineUserId: string,
  japanDay: string,
): Prisma.Sql {
  return Prisma.sql`
    UPDATE "LineLink" SET "reviewNotifiedOn" = CAST(${japanDay} AS DATE)
     WHERE "lineUserId" = ${lineUserId} AND "reviewNotify"
       AND ("reviewNotifiedOn" IS NULL OR "reviewNotifiedOn" < CAST(${japanDay} AS DATE))`;
}

// Callers read `now` once and pass it truncated to milliseconds: the columns
// are TIMESTAMP(3).
export function createLineLinkStore(db: () => PrismaClient) {
  return {
    // The LINE account's link; null when it is not linked.
    async find(lineUserId: string): Promise<LineLink | null> {
      const link = await db().lineLink.findUnique({
        where: { lineUserId },
        select: {
          lineUserId: true,
          userId: true,
          createdAt: true,
          user: { select: { role: true } },
        },
      });
      return link
        ? {
            lineUserId: link.lineUserId,
            ownerId: link.userId,
            role: lineRole(link.user.role),
            createdAt: link.createdAt,
          }
        : null;
    },

    // Whether the user is linked and wants the review message. Not linked
    // reads as reviewNotify false.
    async status(
      userId: string,
    ): Promise<{ linked: boolean; reviewNotify: boolean }> {
      const link = await db().lineLink.findUnique({
        where: { userId },
        select: { reviewNotify: true },
      });
      return link
        ? { linked: true, reviewNotify: link.reviewNotify }
        : { linked: false, reviewNotify: false };
    },

    // Turns the review message on or off. false: no LINE account is linked.
    async setReviewNotify(userId: string, on: boolean): Promise<boolean> {
      const { count } = await db().lineLink.updateMany({
        where: { userId },
        data: { reviewNotify: on },
      });
      return count > 0;
    },

    // Removes the user's link, if any.
    async unlinkOwner(userId: string): Promise<void> {
      await db().lineLink.deleteMany({ where: { userId } });
    },

    // Removes the link when the LINE user unfollowed or asked to unlink.
    async unlinkLineUser(lineUserId: string): Promise<void> {
      await db().lineLink.deleteMany({ where: { lineUserId } });
    },

    // Stores the user's new code by its hash, in place of the previous one.
    async putCode(
      userId: string,
      codeHash: string,
      expiresAt: Date,
    ): Promise<void> {
      await db().$executeRaw(putLinkCodeSql(userId, codeHash, expiresAt));
    },

    // Redeems a code in one transaction: takes the code, drops the
    // user's old link and this LINE account's old link, and links the two.
    // null: unknown or expired. relinked: this LINE account was linked before.
    // role is the user's lineRole.
    async redeemCode(
      codeHash: string,
      lineUserId: string,
      now: Date,
    ): Promise<{ ownerId: string; role: string; relinked: boolean } | null> {
      return db().$transaction(async (tx) => {
        const codes = await tx.$queryRaw<{ userId: string; role: string }[]>(
          Prisma.sql`
            WITH "taken" AS (
              DELETE FROM "LineLinkCode"
               WHERE "codeHash" = ${codeHash} AND "expiresAt" > CAST(${now} AS TIMESTAMP(3))
              RETURNING "userId")
            SELECT t."userId", ${LINE_ROLE} AS "role"
              FROM "taken" t JOIN "user" u ON u."id" = t."userId"`,
        );
        // Nothing was written, so ending here leaves the database as it was.
        if (codes.length === 0) return null;
        const { userId, role } = codes[0];
        const old = await tx.$queryRaw<{ lineUserId: string }[]>(
          Prisma.sql`
            DELETE FROM "LineLink" WHERE "userId" = ${userId} OR "lineUserId" = ${lineUserId}
            RETURNING "lineUserId"`,
        );
        await tx.lineLink.create({
          data: { lineUserId, userId, createdAt: now },
        });
        return {
          ownerId: userId,
          role,
          relinked: old.some((row) => row.lineUserId === lineUserId),
        };
      }, LINE_TRANSACTION_OPTIONS);
    },

    // The links to send today's review message to, at most limit.
    async reviewNotifyTargets(
      now: Date,
      limit: number,
    ): Promise<ReviewNotifyTarget[]> {
      const rows = await db().$queryRaw<
        { lineUserId: string; userId: string; role: string; due: bigint }[]
      >(reviewNotifyTargetsSql(now, japanDate(now), limit));
      return rows.map((row) => ({
        lineUserId: row.lineUserId,
        ownerId: row.userId,
        role: row.role,
        due: Number(row.due),
      }));
    },

    // Claims today's review message. true: this pass may send it.
    async claimReviewNotify(lineUserId: string, now: Date): Promise<boolean> {
      const count = await db().$executeRaw(
        claimReviewNotifySql(lineUserId, japanDate(now)),
      );
      return count === 1;
    },

    // The user exists as a member or an admin: not a guest, not banned.
    async ownerExists(userId: string): Promise<boolean> {
      const rows = await db().$queryRaw<{ found: boolean }[]>(
        lineOwnerExistsSql(userId),
      );
      return rows[0]?.found === true;
    },
  };
}
