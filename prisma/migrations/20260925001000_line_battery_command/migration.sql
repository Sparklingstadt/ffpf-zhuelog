-- Additive: existing jobs remain corrections, and old workers opt out of commands.
ALTER TABLE "LineLearningJob"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'correction',
  ADD COLUMN "replyText" TEXT;
ALTER TABLE "LineLearningJob"
  ADD CONSTRAINT "LineLearningJob_kind_check" CHECK ("kind" IN ('correction', 'battery'));
