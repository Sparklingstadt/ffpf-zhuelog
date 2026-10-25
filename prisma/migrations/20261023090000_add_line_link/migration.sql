-- CreateTable
CREATE TABLE "LineLink" (
    "lineUserId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineLink_pkey" PRIMARY KEY ("lineUserId"),
    CONSTRAINT "LineLink_role_check" CHECK ("role" IN ('member', 'admin'))
);

-- CreateTable
CREATE TABLE "LineLinkCode" (
    "codeHash" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineLinkCode_pkey" PRIMARY KEY ("codeHash"),
    CONSTRAINT "LineLinkCode_role_check" CHECK ("role" IN ('member', 'admin'))
);

-- CreateTable
CREATE TABLE "LineMessage" (
    "id" TEXT NOT NULL,
    "webhookEventId" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "entryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LineMessage_kind_check" CHECK ("kind" IN ('correction', 'translation')),
    CONSTRAINT "LineMessage_status_check" CHECK ("status" IN ('pending', 'done', 'failed'))
);

-- CreateIndex
CREATE UNIQUE INDEX "LineLink_ownerId_key" ON "LineLink"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "LineLinkCode_ownerId_key" ON "LineLinkCode"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "LineMessage_webhookEventId_key" ON "LineMessage"("webhookEventId");

-- CreateIndex
CREATE INDEX "LineMessage_status_createdAt_idx" ON "LineMessage"("status", "createdAt");
