-- Oversized LINE messages are answered with a limit notice instead of ignored.
ALTER TABLE "LineLearningJob" DROP CONSTRAINT "LineLearningJob_kind_check";
ALTER TABLE "LineLearningJob" ADD CONSTRAINT "LineLearningJob_kind_check"
  CHECK ("kind" IN ('correction', 'battery', 'dev-issue', 'dev-reply', 'text-too-long'));
