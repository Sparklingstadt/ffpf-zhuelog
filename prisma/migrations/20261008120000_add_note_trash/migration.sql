-- Notes go to a per-owner trash before they are deleted for good. Existing
-- rows keep deletedAt NULL, so nothing moves to the trash.

-- AlterTable
ALTER TABLE "LearningEntry" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ChatConversation" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LearningEntry_ownerId_deletedAt_idx" ON "LearningEntry"("ownerId", "deletedAt");

-- CreateIndex
CREATE INDEX "ChatConversation_ownerId_deletedAt_idx" ON "ChatConversation"("ownerId", "deletedAt");

