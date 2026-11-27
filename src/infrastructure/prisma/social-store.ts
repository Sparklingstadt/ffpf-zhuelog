import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type {
  FollowDirectory,
  FollowTimelineItem,
} from "../../domain/social/follow";
import { hintsByEntry, toKind } from "./learning-note-reads";
import { IS_MEMBER_USER } from "./member-users";

// Follows, the shared-notes timeline and the member directory. Members are
// the users who are neither admins nor guests (IS_MEMBER_USER).
//
// The directory and the timeline are raw statements run through $queryRaw:
// Prisma's queries cannot order by the "ja-x-icu" collation, and ordering in
// JS would not match the database's Japanese order.
//
// Following is one statement. Follow's foreign keys only say the followee is
// a user, so a data-modifying CTE inserts the row if the followee is a member
// in the statement's snapshot (READ COMMITTED) and reads whether it is.

export type MemberRow = {
  userId: string;
  displayName: string;
  following: boolean;
  followsMe: boolean;
};

export type TimelineRow = {
  id: string;
  kind: string;
  originalText: string;
  correctedText: string;
  pinyin: string;
  createdAt: Date;
  sharedAt: Date | null;
  userId: string;
  ownerName: string;
};

// Pure: the member directory. Every member but the viewer; no login id.
export function memberDirectorySql(viewerId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT u."id" AS "userId", u."name" AS "displayName",
           EXISTS (SELECT 1 FROM "Follow" f WHERE f."followerId" = ${viewerId} AND f."followeeId" = u."id") AS "following",
           EXISTS (SELECT 1 FROM "Follow" f WHERE f."followerId" = u."id" AND f."followeeId" = ${viewerId}) AS "followsMe"
      FROM "user" u
     WHERE ${IS_MEMBER_USER} AND u."id" <> ${viewerId}
     ORDER BY u."name" COLLATE "ja-x-icu", u."createdAt", u."id"`;
}

// Pure: every follow row pointing at the viewer, admins' included.
export function followerCountSql(viewerId: string): Prisma.Sql {
  return Prisma.sql`SELECT count(*) AS "count" FROM "Follow" WHERE "followeeId" = ${viewerId}`;
}

// Pure: the rows and the follower count as the domain's directory. Following
// counts only listed members: a follow of a user who is no longer a member
// is not counted.
export function directoryFromRows(
  rows: MemberRow[],
  followerCount: bigint,
): FollowDirectory {
  return {
    members: rows.map(({ userId, displayName, following, followsMe }) => ({
      ownerId: userId,
      displayName,
      following,
      followsMe,
    })),
    followingCount: rows.filter((row) => row.following).length,
    followerCount: Number(followerCount),
  };
}

// Pure: the newest notes of the members the viewer follows, at most limit.
// Only followed users that are still members; shared, not trashed.
export function timelineSql(viewerId: string, limit: number): Prisma.Sql {
  return Prisma.sql`
    SELECT e."id", e."kind", e."originalText", e."correctedText", e."pinyin", e."createdAt", e."sharedAt",
           e."userId" AS "userId", u."name" AS "ownerName"
      FROM "LearningEntry" e
      JOIN "Follow" f ON f."followeeId" = e."userId" AND f."followerId" = ${viewerId}
      JOIN "user" u ON u."id" = e."userId" AND ${IS_MEMBER_USER}
     WHERE e."sharedAt" IS NOT NULL AND e."deletedAt" IS NULL
     ORDER BY e."createdAt" DESC, e."id" DESC
     LIMIT ${limit}`;
}

// Pure: one statement that adds the follow only when followeeId is an
// existing member, and reads whether it is.
//
// The INSERT ... SELECT parameters have no type to infer, so they are cast. A
// data-modifying CTE runs even though the outer SELECT does not read it.
export function followSql(
  followerId: string,
  followeeId: string,
  now: Date,
): Prisma.Sql {
  return Prisma.sql`
    WITH "target" AS (SELECT 1 FROM "user" u WHERE u."id" = ${followeeId} AND ${IS_MEMBER_USER}),
         "added" AS (
           INSERT INTO "Follow" ("followerId", "followeeId", "createdAt")
           SELECT ${followerId}::text, ${followeeId}::text, CAST(${now} AS TIMESTAMP(3))
            WHERE EXISTS (SELECT 1 FROM "target")
           ON CONFLICT DO NOTHING
           RETURNING 1)
    SELECT EXISTS (SELECT 1 FROM "target") AS "member"`;
}

export function createSocialStore(db: () => PrismaClient) {
  return {
    // Every member but the viewer, by display name, with the counts. Two
    // statements, not a transaction.
    async members(viewerId: string): Promise<FollowDirectory> {
      const rows = await db().$queryRaw<MemberRow[]>(
        memberDirectorySql(viewerId),
      );
      const [{ count }] = await db().$queryRaw<{ count: bigint }[]>(
        followerCountSql(viewerId),
      );
      return directoryFromRows(rows, count);
    },

    // The newest shared notes of the members the viewer follows, each with
    // its hints by position.
    async timeline(
      viewerId: string,
      limit: number,
    ): Promise<FollowTimelineItem[]> {
      const client = db();
      const rows = await client.$queryRaw<TimelineRow[]>(
        timelineSql(viewerId, limit),
      );
      const hints = await hintsByEntry(
        client,
        rows.map((row) => row.id),
      );
      return rows.map((row) => ({
        entry: {
          id: row.id,
          kind: toKind(row.kind),
          originalText: row.originalText,
          correctedText: row.correctedText,
          pinyin: row.pinyin,
          createdAt: row.createdAt,
          sharedAt: row.sharedAt,
          hints: hints.get(row.id) ?? [],
          ownerId: row.userId,
        },
        ownerName: row.ownerName,
      }));
    },

    // false: followeeId is no member. Following twice changes nothing.
    async follow(
      followerId: string,
      followeeId: string,
      now: Date,
    ): Promise<boolean> {
      const rows = await db().$queryRaw<{ member: boolean }[]>(
        followSql(followerId, followeeId, now),
      );
      return rows[0]?.member === true;
    },

    // Removes the follower's follow, if any.
    async unfollow(followerId: string, followeeId: string): Promise<void> {
      await db().follow.deleteMany({ where: { followerId, followeeId } });
    },
  };
}

export type SocialStore = ReturnType<typeof createSocialStore>;
