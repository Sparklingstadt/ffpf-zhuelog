ALTER TABLE "LineLearningJob" ADD COLUMN "issueAttempted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LineLearningJob" DROP CONSTRAINT "LineLearningJob_kind_check";
ALTER TABLE "LineLearningJob" ADD CONSTRAINT "LineLearningJob_kind_check"
  CHECK ("kind" IN ('correction', 'battery', 'dev-issue', 'dev-reply'));
CREATE TABLE "LineDevelopmentSession" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" TIMESTAMP(3),
  "lastEventAt" TIMESTAMP(3) NOT NULL
);
