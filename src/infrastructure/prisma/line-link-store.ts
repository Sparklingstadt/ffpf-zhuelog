// LineLink and LineLinkCode: which LINE account is linked to which owner,
// the one-time codes that link them, and the setting the morning review
// message reads. The code is stored by its hash, there is one code and one
// link per owner, and the review message is claimed once per JST day.
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type {
  LineLink,
  ReviewNotifyTarget,
} from "../../domain/line/line-message";
import { japanDate } from "../../domain/review/review-days";

// Interactive transaction limits for the LINE writes; Prisma's 5 s default is
// too short for a cold Neon start.
export const LINE_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 };

// Pure: replaces the owner's previous code.
export function putLinkCodeSql(
  ownerId: string,
  role: string,
  codeHash: string,
  expiresAt: Date,
): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO "LineLinkCode" ("codeHash", "ownerId", "role", "expiresAt")
    VALUES (${codeHash}, ${ownerId}, ${role}, CAST(${expiresAt} AS TIMESTAMP(3)))
    ON CONFLICT ("ownerId") DO UPDATE SET
      "codeHash" = EXCLUDED."codeHash", "role" = EXCLUDED."role", "expiresAt" = EXCLUDED."expiresAt"`;
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
    SELECT l."lineUserId", l."ownerId", l."role", d."due"
      FROM "LineLink" l
     CROSS JOIN LATERAL (
       SELECT count(*) AS "due" FROM "ReviewItem"
        WHERE "ReviewItem"."ownerId" = l."ownerId" AND "ReviewItem"."due" <= CAST(${now} AS TIMESTAMP(3))
          AND NOT EXISTS (SELECT 1 FROM "LearningEntry" e
                WHERE "ReviewItem"."kind" = 'entry' AND e."id" = "ReviewItem"."targetId"
                  AND e."ownerId" = "ReviewItem"."ownerId" AND e."deletedAt" IS NOT NULL)
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

// The member owner prefixes ("password:" and "sid:").
const PASSWORD_PREFIX = "password:";
const SID_PREFIX = "sid:";

// Callers read `now` once and pass it truncated to milliseconds: the columns
// are TIMESTAMP(3).
export function createLineLinkStore(db: () => PrismaClient) {
  return {
    // The LINE account's link; null when it is not linked.
    async find(lineUserId: string): Promise<LineLink | null> {
      return db().lineLink.findUnique({
        where: { lineUserId },
        select: {
          lineUserId: true,
          ownerId: true,
          role: true,
          createdAt: true,
        },
      });
    },

    // Whether the owner is linked and wants the review message. Not linked
    // reads as reviewNotify false.
    async status(
      ownerId: string,
    ): Promise<{ linked: boolean; reviewNotify: boolean }> {
      const link = await db().lineLink.findUnique({
        where: { ownerId },
        select: { reviewNotify: true },
      });
      return link
        ? { linked: true, reviewNotify: link.reviewNotify }
        : { linked: false, reviewNotify: false };
    },

    // Turns the review message on or off. false: no LINE account is linked.
    async setReviewNotify(ownerId: string, on: boolean): Promise<boolean> {
      const { count } = await db().lineLink.updateMany({
        where: { ownerId },
        data: { reviewNotify: on },
      });
      return count > 0;
    },

    // Removes the owner's link, if any.
    async unlinkOwner(ownerId: string): Promise<void> {
      await db().lineLink.deleteMany({ where: { ownerId } });
    },

    // Removes the link when the LINE user unfollowed or asked to unlink.
    async unlinkLineUser(lineUserId: string): Promise<void> {
      await db().lineLink.deleteMany({ where: { lineUserId } });
    },

    // Stores the owner's new code by its hash, in place of the previous one.
    async putCode(
      ownerId: string,
      role: "member" | "admin",
      codeHash: string,
      expiresAt: Date,
    ): Promise<void> {
      await db().$executeRaw(
        putLinkCodeSql(ownerId, role, codeHash, expiresAt),
      );
    },

    // Redeems a code in one transaction: takes the code, drops the
    // owner's old link and this LINE account's old link, and links the two.
    // null: unknown or expired. relinked: this LINE account was linked before.
    async redeemCode(
      codeHash: string,
      lineUserId: string,
      now: Date,
    ): Promise<{ ownerId: string; role: string; relinked: boolean } | null> {
      return db().$transaction(async (tx) => {
        const codes = await tx.$queryRaw<{ ownerId: string; role: string }[]>(
          Prisma.sql`
            DELETE FROM "LineLinkCode"
             WHERE "codeHash" = ${codeHash} AND "expiresAt" > CAST(${now} AS TIMESTAMP(3))
            RETURNING "ownerId", "role"`,
        );
        // Nothing was written, so ending here leaves the database as it was.
        if (codes.length === 0) return null;
        const { ownerId, role } = codes[0];
        const old = await tx.$queryRaw<{ lineUserId: string }[]>(
          Prisma.sql`
            DELETE FROM "LineLink" WHERE "ownerId" = ${ownerId} OR "lineUserId" = ${lineUserId}
            RETURNING "lineUserId"`,
        );
        await tx.lineLink.create({
          data: { lineUserId, ownerId, role, createdAt: now },
        });
        return {
          ownerId,
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
        { lineUserId: string; ownerId: string; role: string; due: bigint }[]
      >(reviewNotifyTargetsSql(now, japanDate(now), limit));
      return rows.map((row) => ({
        lineUserId: row.lineUserId,
        ownerId: row.ownerId,
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

    // A member exists ("password:<id>" or "sid:<id>"); any other
    // owner id is not a member and the database is not read.
    async memberExists(ownerId: string): Promise<boolean> {
      if (ownerId.startsWith(PASSWORD_PREFIX)) {
        const id = ownerId.slice(PASSWORD_PREFIX.length);
        return (await db().passwordAccount.count({ where: { id } })) > 0;
      }
      if (ownerId.startsWith(SID_PREFIX)) {
        const id = ownerId.slice(SID_PREFIX.length);
        return (await db().sidAccount.count({ where: { id } })) > 0;
      }
      return false;
    },
  };
}
