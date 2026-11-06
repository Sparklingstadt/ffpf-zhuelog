-- Finished rounds of practice of every kind (prepositions, complements),
-- written by the Go API. Replaces "PrepositionPracticeRecord", whose rows
-- are copied here as kind 'preposition'; the old table stays for the Go API
-- still running and is dropped by a later migration.

-- CreateTable
CREATE TABLE "PracticeRecord" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "firstTryCount" INTEGER NOT NULL,
    "missCount" INTEGER NOT NULL,
    "elapsedMs" INTEGER NOT NULL,
    "questions" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PracticeRecord_ownerId_kind_createdAt_idx" ON "PracticeRecord"("ownerId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeRecord_id_ownerId_key" ON "PracticeRecord"("id", "ownerId");

-- Copy the preposition rounds. Each question's "noun" becomes "headword".
INSERT INTO "PracticeRecord"
  ("id", "ownerId", "kind", "questionCount", "firstTryCount", "missCount", "elapsedMs", "questions", "startedAt", "createdAt")
SELECT "id", "ownerId", 'preposition', "questionCount", "firstTryCount", "missCount", "elapsedMs",
  (SELECT COALESCE(jsonb_agg((q - 'noun') || jsonb_build_object('headword', q->'noun') ORDER BY ord), '[]'::jsonb)
   FROM jsonb_array_elements("questions") WITH ORDINALITY AS t(q, ord)),
  "startedAt", "createdAt"
FROM "PrepositionPracticeRecord";
