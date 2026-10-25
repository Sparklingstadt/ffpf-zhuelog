-- Finished rounds of preposition practice, written by the Go API.

-- CreateTable
CREATE TABLE "PrepositionPracticeRecord" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "firstTryCount" INTEGER NOT NULL,
    "missCount" INTEGER NOT NULL,
    "elapsedMs" INTEGER NOT NULL,
    "questions" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrepositionPracticeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrepositionPracticeRecord_ownerId_createdAt_idx" ON "PrepositionPracticeRecord"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrepositionPracticeRecord_id_ownerId_key" ON "PrepositionPracticeRecord"("id", "ownerId");
