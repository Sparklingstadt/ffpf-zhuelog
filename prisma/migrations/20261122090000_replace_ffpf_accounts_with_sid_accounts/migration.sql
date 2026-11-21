-- Replaces the "FFPF ID" sign-in with "Sparklingstadt ID". The new table has
-- the same columns as "FfpfAccount"; owner ids change from "ffpf:<sub>" to
-- "sid:<sub>". Accounts and data are not carried over: every row owned by an
-- "ffpf:" owner is deleted, and people sign in again with Sparklingstadt ID.
-- No table has a foreign key to an owner id, so each is deleted by hand.

-- CreateTable
CREATE TABLE "SidAccount" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SidAccount_pkey" PRIMARY KEY ("id")
);

-- Import batches that hold only "ffpf:" notes go, and their notes and hints
-- with them (ON DELETE CASCADE). A batch that also holds another owner's notes stays.
DELETE FROM "ImportBatch" b
WHERE EXISTS (SELECT 1 FROM "LearningEntry" e WHERE e."batchId" = b."id" AND e."ownerId" LIKE 'ffpf:%')
  AND NOT EXISTS (SELECT 1 FROM "LearningEntry" e WHERE e."batchId" = b."id" AND e."ownerId" NOT LIKE 'ffpf:%');

-- Any "ffpf:" notes left (in a shared batch); their "Hint" rows go with them.
DELETE FROM "LearningEntry" WHERE "ownerId" LIKE 'ffpf:%';

-- Reviews ("ReviewLog" rows would also go with "ReviewItem": ON DELETE CASCADE).
DELETE FROM "ReviewLog" WHERE "ownerId" LIKE 'ffpf:%';
DELETE FROM "ReviewItem" WHERE "ownerId" LIKE 'ffpf:%';

DELETE FROM "VocabularyEntry" WHERE "ownerId" LIKE 'ffpf:%';
DELETE FROM "ChatConversation" WHERE "ownerId" LIKE 'ffpf:%';
DELETE FROM "QuickQuestion" WHERE "ownerId" LIKE 'ffpf:%';
DELETE FROM "PrepositionPracticeRecord" WHERE "ownerId" LIKE 'ffpf:%';
DELETE FROM "ComplementPracticeRecord" WHERE "ownerId" LIKE 'ffpf:%';

-- Follows, whichever side the owner is on.
DELETE FROM "Follow" WHERE "followerId" LIKE 'ffpf:%' OR "followeeId" LIKE 'ffpf:%';

DELETE FROM "LineLink" WHERE "ownerId" LIKE 'ffpf:%';
DELETE FROM "LineLinkCode" WHERE "ownerId" LIKE 'ffpf:%';
DELETE FROM "LineMessage" WHERE "ownerId" LIKE 'ffpf:%';

DELETE FROM "Session" WHERE "ownerId" LIKE 'ffpf:%';
DELETE FROM "AiUsage" WHERE "ownerId" LIKE 'ffpf:%';

-- DropTable
DROP TABLE "FfpfAccount";
