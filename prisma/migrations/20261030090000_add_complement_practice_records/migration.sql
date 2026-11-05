-- Finished rounds of complement practice, written by the Go API.

-- CreateTable
CREATE TABLE "ComplementPracticeRecord" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "mode" TEXT NOT NULL CHECK ("mode" IN ('result', 'potential', 'degree')),
    "questionCount" INTEGER NOT NULL,
    "firstTryCount" INTEGER NOT NULL,
    "missCount" INTEGER NOT NULL,
    "elapsedMs" INTEGER NOT NULL,
    "questions" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplementPracticeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplementPracticeRecord_ownerId_createdAt_idx" ON "ComplementPracticeRecord"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ComplementPracticeRecord_id_ownerId_key" ON "ComplementPracticeRecord"("id", "ownerId");
