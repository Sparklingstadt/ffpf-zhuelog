CREATE TABLE "QuickQuestion" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuickQuestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "QuickQuestion_ownerId_createdAt_idx" ON "QuickQuestion"("ownerId", "createdAt");
