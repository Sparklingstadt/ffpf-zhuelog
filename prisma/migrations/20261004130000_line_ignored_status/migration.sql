-- Ignored development-mode input keeps a row so webhook redeliveries stay deduplicated.
ALTER TABLE "LineLearningJob" DROP CONSTRAINT "LineLearningJob_status_check";
ALTER TABLE "LineLearningJob" ADD CONSTRAINT "LineLearningJob_status_check"
  CHECK ("status" IN ('PENDING', 'GENERATING', 'READY', 'SENDING', 'SENT', 'FAILED', 'IGNORED'));
