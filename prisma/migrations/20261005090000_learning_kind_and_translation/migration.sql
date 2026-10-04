-- Learning notes are either corrections or translations (existing rows are corrections).
ALTER TABLE "LearningEntry" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'correction';
ALTER TABLE "LearningEntry" ADD CONSTRAINT "LearningEntry_kind_check"
  CHECK ("kind" IN ('correction', 'translation'));
ALTER TABLE "LineLearningJob" DROP CONSTRAINT "LineLearningJob_kind_check";
ALTER TABLE "LineLearningJob" ADD CONSTRAINT "LineLearningJob_kind_check"
  CHECK ("kind" IN ('correction', 'translation', 'battery', 'dev-issue', 'dev-reply', 'text-too-long'));
