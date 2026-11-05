-- CreateTable
CREATE TABLE "VocabularyEntry" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "pinyin" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "sourceEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VocabularyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VocabularyEntry_ownerId_createdAt_idx" ON "VocabularyEntry"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VocabularyEntry_ownerId_language_word_key" ON "VocabularyEntry"("ownerId", "language", "word");
