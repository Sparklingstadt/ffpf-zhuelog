-- Notes can be shared with the members who follow their owner. Existing rows
-- keep sharedAt NULL, so nothing is shared until its owner turns it on.

-- AlterTable
ALTER TABLE "LearningEntry" ADD COLUMN     "sharedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Follow" (
    "followerId" TEXT NOT NULL,
    "followeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("followerId","followeeId")
);

-- CreateIndex
CREATE INDEX "Follow_followeeId_idx" ON "Follow"("followeeId");

-- CreateIndex
CREATE INDEX "LearningEntry_ownerId_sharedAt_idx" ON "LearningEntry"("ownerId", "sharedAt");
