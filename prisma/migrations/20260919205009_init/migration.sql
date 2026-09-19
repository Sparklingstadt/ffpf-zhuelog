-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningEntry" (
    "id" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "correctedText" TEXT NOT NULL,
    "pinyin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batchId" TEXT NOT NULL,

    CONSTRAINT "LearningEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hint" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "learningEntryId" TEXT NOT NULL,

    CONSTRAINT "Hint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningEntry_createdAt_idx" ON "LearningEntry"("createdAt");

-- CreateIndex
CREATE INDEX "LearningEntry_batchId_idx" ON "LearningEntry"("batchId");

-- CreateIndex
CREATE INDEX "Hint_learningEntryId_idx" ON "Hint"("learningEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Hint_learningEntryId_position_key" ON "Hint"("learningEntryId", "position");

-- AddForeignKey
ALTER TABLE "LearningEntry" ADD CONSTRAINT "LearningEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hint" ADD CONSTRAINT "Hint_learningEntryId_fkey" FOREIGN KEY ("learningEntryId") REFERENCES "LearningEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
