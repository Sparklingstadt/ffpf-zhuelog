// LineLink and LineLinkCode, with the statements of Go's store/line.go and
// store/line_review_notify.go (stage 10 reference section 12). Go and the web
// share these tables while LINE moves to the web (plan decision 4, reference
// section 20): a code the web issues is redeemed by Go's webhook, and Go's
// morning review message reads the setting the web writes. So every write
// keeps Go's meaning: the code is stored by its hash, one code and one link
// per owner, and the review message is claimed once per JST day.
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type {
  LineLink,
  ReviewNotifyTarget,
} from "../../domain/line/line-message";
import { japanDate } from "../../domain/review/review-days";

// Interactive transaction limits for the LINE writes; Prisma's 5 s default is
// too short for a cold Neon start.
export const LINE_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 };

// Pure: Go's PutLineLinkCode (line.go:103-113). Replaces the owner's
// previous code.
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

// Pure: Go's ListReviewNotifyTargets (line_review_notify.go:58-87). Every
// kind and language counts; notes in the trash do not. japanDay is now's JST
// date (YYYY-MM-DD).
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

// Pure: Go's ClaimReviewNotify (line_review_notify.go:93-102). One
// conditional UPDATE, so two passes on the same day cannot both claim.
export function claimReviewNotifySql(
  lineUserId: string,
  japanDay: string,
): Prisma.Sql {
  return Prisma.sql`
    UPDATE "LineLink" SET "reviewNotifiedOn" = CAST(${japanDay} AS DATE)
     WHERE "lineUserId" = ${lineUserId} AND "reviewNotify"
       AND ("reviewNotifiedOn" IS NULL OR "reviewNotifiedOn" < CAST(${japanDay} AS DATE))`;
}

// Go: store.MemberOwnerPrefix and store.FfpfOwnerPrefix.
const PASSWORD_PREFIX = "password:";
const FFPF_PREFIX = "ffpf:";

// Callers read `now` once and pass it truncated to milliseconds, as Go's
// dbTime does.
export function createLineLinkStore(db: () => PrismaClient) {
  return {
    // Go: FindLineLink.
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

    // Go: LineReviewNotify. Not linked reads as reviewNotify false, as Go's
    // COALESCE did.
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

    // Go: SetLineReviewNotify. false: no LINE account is linked.
    async setReviewNotify(ownerId: string, on: boolean): Promise<boolean> {
      const { count } = await db().lineLink.updateMany({
        where: { ownerId },
        data: { reviewNotify: on },
      });
      return count > 0;
    },

    // Go: DeleteLineLinkByOwner.
    async unlinkOwner(ownerId: string): Promise<void> {
      await db().lineLink.deleteMany({ where: { ownerId } });
    },

    // Go: DeleteLineLink (the LINE user unfollowed or asked to unlink).
    async unlinkLineUser(lineUserId: string): Promise<void> {
      await db().lineLink.deleteMany({ where: { lineUserId } });
    },

    // Go: PutLineLinkCode.
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

    // Go: RedeemLineLinkCode, in one transaction: takes the code, drops the
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

    // Go: ListReviewNotifyTargets.
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

    // Go: ClaimReviewNotify. true: this pass may send today's message.
    async claimReviewNotify(lineUserId: string, now: Date): Promise<boolean> {
      const count = await db().$executeRaw(
        claimReviewNotifySql(lineUserId, japanDate(now)),
      );
      return count === 1;
    },

    // Go: store.MemberExists ("password:<id>" or "ffpf:<id>"); any other
    // owner id is not a member and the database is not read.
    async memberExists(ownerId: string): Promise<boolean> {
      if (ownerId.startsWith(PASSWORD_PREFIX)) {
        const id = ownerId.slice(PASSWORD_PREFIX.length);
        return (await db().passwordAccount.count({ where: { id } })) > 0;
      }
      if (ownerId.startsWith(FFPF_PREFIX)) {
        const id = ownerId.slice(FFPF_PREFIX.length);
        return (await db().ffpfAccount.count({ where: { id } })) > 0;
      }
      return false;
    },
  };
}
