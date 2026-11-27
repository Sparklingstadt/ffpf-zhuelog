-- Moves the owner of every row to Better Auth's "user" (stage 3 of the move to
-- Better Auth). The whole body is one explicit transaction (BEGIN ... COMMIT),
-- so any error, the unmapped-owner check included, leaves the database as it
-- was.
--
--   "password:<id>"  PasswordAccount -> "user" (same id) + "account" credential
--   "sid:<sub>"      SidAccount      -> "user" (new id)  + "account" sid (accountId <sub>)
--   "<githubId>"     the admin row of "_better_auth_admin", put there by the
--                    deployment script (scripts/, Task 4) -> "user" (role admin,
--                    new id) + "account" sid (accountId its sidSub)
--
-- An owner id that maps to no user stops the migration before anything is
-- constrained: nothing is deleted silently. Guests own no rows. Afterwards the
-- old account, session and throttle tables are dropped (their Prisma models
-- stay until the code that uses them is removed).

BEGIN;

-- 1. The admin to bring over; empty when the deployment script did not run.
CREATE TABLE IF NOT EXISTS "_better_auth_admin" (
    "githubId" TEXT,
    "sidSub" TEXT,
    "email" TEXT,
    "name" TEXT
);

DO $$
BEGIN
  IF (SELECT count(*) FROM "_better_auth_admin") > 1 THEN
    RAISE EXCEPTION 'owner_to_user: "_better_auth_admin" has more than one row';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "_better_auth_admin"
     WHERE "githubId" IS NULL OR "githubId" !~ '^[0-9]+$'
        OR "sidSub" IS NULL OR "sidSub" = ''
        OR "email" IS NULL OR "email" = ''
        OR "name" IS NULL OR "name" = ''
  ) THEN
    RAISE EXCEPTION 'owner_to_user: the "_better_auth_admin" row needs a numeric githubId, a sidSub, an email and a name';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "_better_auth_admin" a JOIN "SidAccount" s ON s."id" = a."sidSub"
  ) THEN
    RAISE EXCEPTION 'owner_to_user: the admin''s sidSub already belongs to a SidAccount member';
  END IF;
END $$;

-- 5. The map from every old owner id to its user id, made first so the
-- generated ids of SID members and the admin are known.
CREATE TABLE "_owner_map" (
    "ownerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "_owner_map_pkey" PRIMARY KEY ("ownerId")
);

INSERT INTO "_owner_map" ("ownerId", "userId")
SELECT 'password:' || p."id", p."id" FROM "PasswordAccount" p;

INSERT INTO "_owner_map" ("ownerId", "userId")
SELECT 'sid:' || s."id", gen_random_uuid()::text FROM "SidAccount" s;

INSERT INTO "_owner_map" ("ownerId", "userId")
SELECT a."githubId", gen_random_uuid()::text FROM "_better_auth_admin" a;

-- 2. Password members: same id, a mail address that cannot receive mail
-- (memberEmail in better-auth-rules.ts), the login id as username.
INSERT INTO "user" ("id", "name", "email", "emailVerified", "username", "displayUsername", "isAnonymous", "role", "banned", "createdAt", "updatedAt")
SELECT p."id", p."displayName", p."loginId" || '@members.zhuelog.invalid', false, p."loginId", p."loginId", false, 'user', false, p."createdAt", p."updatedAt"
  FROM "PasswordAccount" p;

INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."id", 'credential', p."id", p."passwordHash", p."createdAt", p."updatedAt"
  FROM "PasswordAccount" p;

-- 3. Sparklingstadt ID members: a new id, linked by their sub.
INSERT INTO "user" ("id", "name", "email", "emailVerified", "isAnonymous", "role", "banned", "createdAt", "updatedAt")
SELECT m."userId", s."displayName", s."email", true, false, 'user', false, s."createdAt", s."updatedAt"
  FROM "SidAccount" s JOIN "_owner_map" m ON m."ownerId" = 'sid:' || s."id";

INSERT INTO "account" ("id", "accountId", "providerId", "userId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."id", 'sid', m."userId", s."createdAt", s."updatedAt"
  FROM "SidAccount" s JOIN "_owner_map" m ON m."ownerId" = 'sid:' || s."id";

-- 4. The admin: linked by the SID sub only, never by mail address.
INSERT INTO "user" ("id", "name", "email", "emailVerified", "isAnonymous", "role", "banned", "createdAt", "updatedAt")
SELECT m."userId", a."name", a."email", true, false, 'admin', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "_better_auth_admin" a JOIN "_owner_map" m ON m."ownerId" = a."githubId";

INSERT INTO "account" ("id", "accountId", "providerId", "userId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, a."sidSub", 'sid', m."userId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "_better_auth_admin" a JOIN "_owner_map" m ON m."ownerId" = a."githubId";

-- 6. Each owned table gets "userId" from the map; Follow gets both of its
-- columns mapped into new ones. An owner not in the map is left NULL.

ALTER TABLE "LearningEntry" ADD COLUMN "userId" TEXT;
UPDATE "LearningEntry" t SET "userId" = m."userId" FROM "_owner_map" m WHERE m."ownerId" = t."ownerId";

ALTER TABLE "ChatConversation" ADD COLUMN "userId" TEXT;
UPDATE "ChatConversation" t SET "userId" = m."userId" FROM "_owner_map" m WHERE m."ownerId" = t."ownerId";

ALTER TABLE "PrepositionPracticeRecord" ADD COLUMN "userId" TEXT;
UPDATE "PrepositionPracticeRecord" t SET "userId" = m."userId" FROM "_owner_map" m WHERE m."ownerId" = t."ownerId";

ALTER TABLE "QuickQuestion" ADD COLUMN "userId" TEXT;
UPDATE "QuickQuestion" t SET "userId" = m."userId" FROM "_owner_map" m WHERE m."ownerId" = t."ownerId";

ALTER TABLE "ComplementPracticeRecord" ADD COLUMN "userId" TEXT;
UPDATE "ComplementPracticeRecord" t SET "userId" = m."userId" FROM "_owner_map" m WHERE m."ownerId" = t."ownerId";

ALTER TABLE "ReviewItem" ADD COLUMN "userId" TEXT;
UPDATE "ReviewItem" t SET "userId" = m."userId" FROM "_owner_map" m WHERE m."ownerId" = t."ownerId";

ALTER TABLE "ReviewLog" ADD COLUMN "userId" TEXT;
UPDATE "ReviewLog" t SET "userId" = m."userId" FROM "_owner_map" m WHERE m."ownerId" = t."ownerId";

ALTER TABLE "VocabularyEntry" ADD COLUMN "userId" TEXT;
UPDATE "VocabularyEntry" t SET "userId" = m."userId" FROM "_owner_map" m WHERE m."ownerId" = t."ownerId";

ALTER TABLE "AiUsage" ADD COLUMN "userId" TEXT;
UPDATE "AiUsage" t SET "userId" = m."userId" FROM "_owner_map" m WHERE m."ownerId" = t."ownerId";

ALTER TABLE "LineLink" ADD COLUMN "userId" TEXT;
UPDATE "LineLink" t SET "userId" = m."userId" FROM "_owner_map" m WHERE m."ownerId" = t."ownerId";

ALTER TABLE "LineLinkCode" ADD COLUMN "userId" TEXT;
UPDATE "LineLinkCode" t SET "userId" = m."userId" FROM "_owner_map" m WHERE m."ownerId" = t."ownerId";

ALTER TABLE "LineMessage" ADD COLUMN "userId" TEXT;
UPDATE "LineMessage" t SET "userId" = m."userId" FROM "_owner_map" m WHERE m."ownerId" = t."ownerId";

ALTER TABLE "Follow" ADD COLUMN "followerUserId" TEXT,
                       ADD COLUMN "followeeUserId" TEXT;
UPDATE "Follow" f SET "followerUserId" = m."userId" FROM "_owner_map" m WHERE m."ownerId" = f."followerId";
UPDATE "Follow" f SET "followeeUserId" = m."userId" FROM "_owner_map" m WHERE m."ownerId" = f."followeeId";

-- 7. Stop on any row whose owner has no user, naming each table, its count
-- and up to five of the owner ids.
DO $$
DECLARE
  unmapped TEXT;
BEGIN
  WITH "rows" AS (
              SELECT 'LearningEntry' AS "table", "ownerId" FROM "LearningEntry" WHERE "userId" IS NULL
    UNION ALL SELECT 'ChatConversation' AS "table", "ownerId" FROM "ChatConversation" WHERE "userId" IS NULL
    UNION ALL SELECT 'PrepositionPracticeRecord' AS "table", "ownerId" FROM "PrepositionPracticeRecord" WHERE "userId" IS NULL
    UNION ALL SELECT 'QuickQuestion' AS "table", "ownerId" FROM "QuickQuestion" WHERE "userId" IS NULL
    UNION ALL SELECT 'ComplementPracticeRecord' AS "table", "ownerId" FROM "ComplementPracticeRecord" WHERE "userId" IS NULL
    UNION ALL SELECT 'ReviewItem' AS "table", "ownerId" FROM "ReviewItem" WHERE "userId" IS NULL
    UNION ALL SELECT 'ReviewLog' AS "table", "ownerId" FROM "ReviewLog" WHERE "userId" IS NULL
    UNION ALL SELECT 'VocabularyEntry' AS "table", "ownerId" FROM "VocabularyEntry" WHERE "userId" IS NULL
    UNION ALL SELECT 'AiUsage' AS "table", "ownerId" FROM "AiUsage" WHERE "userId" IS NULL
    UNION ALL SELECT 'LineLink' AS "table", "ownerId" FROM "LineLink" WHERE "userId" IS NULL
    UNION ALL SELECT 'LineLinkCode' AS "table", "ownerId" FROM "LineLinkCode" WHERE "userId" IS NULL
    UNION ALL SELECT 'LineMessage' AS "table", "ownerId" FROM "LineMessage" WHERE "userId" IS NULL
    UNION ALL SELECT 'Follow', CASE WHEN "followerUserId" IS NULL THEN "followerId" ELSE "followeeId" END
                FROM "Follow" WHERE "followerUserId" IS NULL OR "followeeUserId" IS NULL
  )
  SELECT string_agg(format('"%s": %s row(s) (owners: %s)', "table", "count", "owners"), '; ' ORDER BY "table")
    INTO unmapped
    FROM (SELECT "table", count(*) AS "count",
                 array_to_string((array_agg(DISTINCT "ownerId" ORDER BY "ownerId"))[1:5], ', ') AS "owners"
            FROM "rows" GROUP BY "table") AS "byTable";
  IF unmapped IS NOT NULL THEN
    RAISE EXCEPTION 'owner_to_user: rows whose owner has no user; nothing was changed. %', unmapped;
  END IF;
END $$;

-- 8. Constrain the new columns and drop the old ones (their indexes go with
-- them), then rebuild the indexes, unique constraints and keys on "userId".

ALTER TABLE "LearningEntry" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "ChatConversation" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "PrepositionPracticeRecord" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "QuickQuestion" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "ComplementPracticeRecord" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "ReviewItem" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "ReviewLog" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "VocabularyEntry" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "AiUsage" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "LineLink" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "LineLinkCode" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "LineMessage" ALTER COLUMN "userId" SET NOT NULL;

ALTER TABLE "LearningEntry" DROP COLUMN "ownerId";
ALTER TABLE "ChatConversation" DROP COLUMN "ownerId";
ALTER TABLE "PrepositionPracticeRecord" DROP COLUMN "ownerId";
ALTER TABLE "QuickQuestion" DROP COLUMN "ownerId";
ALTER TABLE "ComplementPracticeRecord" DROP COLUMN "ownerId";
ALTER TABLE "ReviewItem" DROP COLUMN "ownerId";
ALTER TABLE "ReviewLog" DROP COLUMN "ownerId";
ALTER TABLE "VocabularyEntry" DROP COLUMN "ownerId";
ALTER TABLE "AiUsage" DROP COLUMN "ownerId";
ALTER TABLE "LineLink" DROP COLUMN "ownerId";
ALTER TABLE "LineLinkCode" DROP COLUMN "ownerId";
ALTER TABLE "LineMessage" DROP COLUMN "ownerId";

-- The role now comes from "user"."role".
ALTER TABLE "LineLink" DROP COLUMN "role";
ALTER TABLE "LineLinkCode" DROP COLUMN "role";

ALTER TABLE "Follow" DROP CONSTRAINT "Follow_pkey";
DROP INDEX "Follow_followeeId_idx";
ALTER TABLE "Follow" DROP COLUMN "followerId",
                     DROP COLUMN "followeeId";
ALTER TABLE "Follow" RENAME COLUMN "followerUserId" TO "followerId";
ALTER TABLE "Follow" RENAME COLUMN "followeeUserId" TO "followeeId";
ALTER TABLE "Follow" ALTER COLUMN "followerId" SET NOT NULL,
                     ALTER COLUMN "followeeId" SET NOT NULL;
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_pkey" PRIMARY KEY ("followerId", "followeeId");

-- CreateIndex
CREATE INDEX "LearningEntry_userId_createdAt_idx" ON "LearningEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LearningEntry_userId_deletedAt_idx" ON "LearningEntry"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "LearningEntry_userId_sharedAt_idx" ON "LearningEntry"("userId", "sharedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatConversation_id_userId_key" ON "ChatConversation"("id", "userId");

-- CreateIndex
CREATE INDEX "ChatConversation_userId_updatedAt_idx" ON "ChatConversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatConversation_userId_createdAt_idx" ON "ChatConversation"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrepositionPracticeRecord_id_userId_key" ON "PrepositionPracticeRecord"("id", "userId");

-- CreateIndex
CREATE INDEX "PrepositionPracticeRecord_userId_createdAt_idx" ON "PrepositionPracticeRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "QuickQuestion_userId_createdAt_idx" ON "QuickQuestion"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ComplementPracticeRecord_id_userId_key" ON "ComplementPracticeRecord"("id", "userId");

-- CreateIndex
CREATE INDEX "ComplementPracticeRecord_userId_createdAt_idx" ON "ComplementPracticeRecord"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewItem_userId_language_kind_targetId_key" ON "ReviewItem"("userId", "language", "kind", "targetId");

-- CreateIndex
CREATE INDEX "ReviewItem_userId_due_idx" ON "ReviewItem"("userId", "due");

-- CreateIndex
CREATE INDEX "ReviewLog_userId_reviewedAt_idx" ON "ReviewLog"("userId", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VocabularyEntry_userId_language_word_key" ON "VocabularyEntry"("userId", "language", "word");

-- CreateIndex
CREATE INDEX "VocabularyEntry_userId_createdAt_idx" ON "VocabularyEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_userId_createdAt_idx" ON "AiUsage"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LineLink_userId_key" ON "LineLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LineLinkCode_userId_key" ON "LineLinkCode"("userId");

-- CreateIndex
CREATE INDEX "Follow_followeeId_idx" ON "Follow"("followeeId");

-- AddForeignKey
ALTER TABLE "LearningEntry" ADD CONSTRAINT "LearningEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepositionPracticeRecord" ADD CONSTRAINT "PrepositionPracticeRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickQuestion" ADD CONSTRAINT "QuickQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplementPracticeRecord" ADD CONSTRAINT "ComplementPracticeRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabularyEntry" ADD CONSTRAINT "VocabularyEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineLink" ADD CONSTRAINT "LineLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineLinkCode" ADD CONSTRAINT "LineLinkCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineMessage" ADD CONSTRAINT "LineMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followeeId_fkey" FOREIGN KEY ("followeeId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 9. The old tables and the work tables. Everyone signs in again afterwards.
DROP TABLE "PasswordAccount";
DROP TABLE "SidAccount";
DROP TABLE "Session";
DROP TABLE "SignInThrottle";
DROP TABLE "FfpfAccount";
DROP TABLE "_owner_map";
DROP TABLE "_better_auth_admin";

COMMIT;
