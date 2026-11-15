-- Note search (services/api/store/entries.go) matches lower(column) LIKE
-- '%term%' on the written text, the corrected text, the pinyin and the hints.
-- Trigram GIN indexes on those expressions let it skip notes that cannot
-- match. Prisma's schema cannot express indexes on an expression, so they
-- live only here. IF NOT EXISTS lets a database that had this applied by hand
-- take it again through prisma migrate deploy.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LearningEntry_originalText_trgm_idx" ON "LearningEntry" USING GIN (lower("originalText") gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LearningEntry_correctedText_trgm_idx" ON "LearningEntry" USING GIN (lower("correctedText") gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LearningEntry_pinyin_trgm_idx" ON "LearningEntry" USING GIN (lower("pinyin") gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Hint_content_trgm_idx" ON "Hint" USING GIN (lower("content") gin_trgm_ops);
