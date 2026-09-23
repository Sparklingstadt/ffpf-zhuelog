CREATE TABLE "LineLearningJob" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "leaseToken" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generationTries" INTEGER NOT NULL DEFAULT 0,
    "deliveryTries" INTEGER NOT NULL DEFAULT 0,
    "csv" TEXT,
    "entryId" TEXT,
    "retryKey" TEXT NOT NULL,
    "firstDeliveryAt" TIMESTAMP(3),
    "failureCode" TEXT,
    CONSTRAINT "LineLearningJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LineLearningJob_status_check" CHECK ("status" IN ('PENDING', 'GENERATING', 'READY', 'SENDING', 'SENT', 'FAILED'))
);
CREATE UNIQUE INDEX "LineLearningJob_eventId_key" ON "LineLearningJob"("eventId");
CREATE UNIQUE INDEX "LineLearningJob_entryId_key" ON "LineLearningJob"("entryId");
CREATE UNIQUE INDEX "LineLearningJob_retryKey_key" ON "LineLearningJob"("retryKey");
CREATE INDEX "LineLearningJob_status_availableAt_idx" ON "LineLearningJob"("status", "availableAt");
