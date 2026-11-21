import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import {
  isMemberOwnerId,
  type FollowDirectory,
  type FollowTimelineItem,
} from "../../domain/social/follow";
import { hintsByEntry, toKind } from "./learning-note-reads";

// Follows, the shared-notes timeline and the member directory, as the retired
// Go API's store/follows.go read and wrote them.
//
// The directory and the timeline are Go's statements run through $queryRaw:
// Prisma's queries cannot UNION ALL the two account tables nor order by the
// "ja-x-icu" collation, and ordering in JS would not match the database's
// Japanese order.
//
// Following is one statement: Go asked MemberExists and then inserted, so a
// member removed in between still got the row (Follow has no foreign key).
// Here a data-modifying CTE inserts the row if the followee's account exists
// in the statement's snapshot (READ COMMITTED) and reads whether it does. A
// delete committed concurrently can still race, so the window is narrower
// than Go's two statements but not closed.
//
// Same results as Go's ListMembers (reference section 1), Follow/Unfollow
// (section 2) and ListTimeline without the cursor (section 3) in
// docs/superpowers/plans/2026-11-16-deprecate-go-stage9-go-reference.md.

export type MemberRow = {
  ownerId: string;
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
  ownerId: string;
  ownerName: string;
};

// Pure: Go's ListMembers statement (go-reference section 1, statement 1). Everyone with a
// password or FFPF account but the viewer; no login id.
export function memberDirectorySql(viewerId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT a."ownerId" AS "ownerId", a."displayName" AS "displayName",
           EXISTS (SELECT 1 FROM "Follow" f WHERE f."followerId" = ${viewerId} AND f."followeeId" = a."ownerId") AS "following",
           EXISTS (SELECT 1 FROM "Follow" f WHERE f."followerId" = a."ownerId" AND f."followeeId" = ${viewerId}) AS "followsMe"
      FROM (SELECT 'password:' || p."id" AS "ownerId", p."displayName", p."createdAt" FROM "PasswordAccount" p
            UNION ALL
            SELECT 'ffpf:' || f."id", f."displayName", f."createdAt" FROM "FfpfAccount" f) a
     WHERE a."ownerId" <> ${viewerId}
     ORDER BY a."displayName" COLLATE "ja-x-icu", a."createdAt", a."ownerId"`;
}

// Pure: every follow row pointing at the viewer, admins' included.
export function followerCountSql(viewerId: string): Prisma.Sql {
  return Prisma.sql`SELECT count(*) AS "count" FROM "Follow" WHERE "followeeId" = ${viewerId}`;
}

// Pure: the rows and the follower count as the domain's directory. Following
// counts only listed members: a follow of a removed account is not counted.
export function directoryFromRows(
  rows: MemberRow[],
  followerCount: bigint,
): FollowDirectory {
  return {
    members: rows.map(({ ownerId, displayName, following, followsMe }) => ({
      ownerId,
      displayName,
      following,
      followsMe,
    })),
    followingCount: rows.filter((row) => row.following).length,
    followerCount: Number(followerCount),
  };
}

// Pure: Go's ListTimeline statement without the cursor (go-reference
// section 3).
// Only followed owners that still have an account; shared, not trashed.
export function timelineSql(viewerId: string, limit: number): Prisma.Sql {
  return Prisma.sql`
    SELECT e."id", e."kind", e."originalText", e."correctedText", e."pinyin", e."createdAt", e."sharedAt",
           e."ownerId" AS "ownerId", a."displayName" AS "ownerName"
      FROM "LearningEntry" e
      JOIN "Follow" f ON f."followeeId" = e."ownerId" AND f."followerId" = ${viewerId}
      JOIN (SELECT 'password:' || p."id" AS "ownerId", p."displayName" FROM "PasswordAccount" p
            UNION ALL
            SELECT 'ffpf:' || ff."id", ff."displayName" FROM "FfpfAccount" ff) a ON a."ownerId" = e."ownerId"
     WHERE e."sharedAt" IS NOT NULL AND e."deletedAt" IS NULL
     ORDER BY e."createdAt" DESC, e."id" DESC
     LIMIT ${limit}`;
}

// The account table of each member owner id prefix, as fixed fragments.
const PASSWORD_ACCOUNT = Prisma.sql`"PasswordAccount"`;
const FFPF_ACCOUNT = Prisma.sql`"FfpfAccount"`;
const PASSWORD_PREFIX = "password:";
const FFPF_PREFIX = "ffpf:";

// Pure: one statement that adds the follow only when followeeId is an
// existing member, and reads whether it is. RangeError for an id that is
// not isMemberOwnerId.
//
// The INSERT ... SELECT parameters have no type to infer, so they are cast. A
// data-modifying CTE runs even though the outer SELECT does not read it.
export function followSql(
  followerId: string,
  followeeId: string,
  now: Date,
): Prisma.Sql {
  if (!isMemberOwnerId(followeeId)) {
    throw new RangeError("not a member owner id");
  }
  const [table, id] = followeeId.startsWith(PASSWORD_PREFIX)
    ? [PASSWORD_ACCOUNT, followeeId.slice(PASSWORD_PREFIX.length)]
    : [FFPF_ACCOUNT, followeeId.slice(FFPF_PREFIX.length)];
  return Prisma.sql`
    WITH "target" AS (SELECT 1 FROM ${table} WHERE "id" = ${id}),
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
    // Every member but the viewer, in Go's order, with the counts. Two
    // statements, not a transaction, as Go read them.
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
          ownerId: row.ownerId,
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
