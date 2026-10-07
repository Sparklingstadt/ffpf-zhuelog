-- Learning notes used to be shared; they now belong to one owner. Every
-- existing note is assigned to the administrator's GitHub account.

-- AlterTable
ALTER TABLE "LearningEntry" ADD COLUMN     "ownerId" TEXT;

UPDATE "LearningEntry" SET "ownerId" = '219588180';

ALTER TABLE "LearningEntry" ALTER COLUMN "ownerId" SET NOT NULL;

-- DropIndex
DROP INDEX "LearningEntry_createdAt_idx";

-- CreateIndex
CREATE INDEX "LearningEntry_ownerId_createdAt_idx" ON "LearningEntry"("ownerId", "createdAt");
