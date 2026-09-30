CREATE TABLE "ChatConversation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "ended" BOOLEAN NOT NULL,
    "messages" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatConversation_id_ownerId_key" ON "ChatConversation"("id", "ownerId");
CREATE INDEX "ChatConversation_ownerId_updatedAt_idx" ON "ChatConversation"("ownerId", "updatedAt");
