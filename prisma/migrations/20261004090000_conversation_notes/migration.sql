-- CreateTable
CREATE TABLE "ConversationNote" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "noteId" TEXT NOT NULL,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ConversationMessage_role_check" CHECK ("role" IN ('user', 'assistant'))
);

-- CreateIndex
CREATE INDEX "ConversationNote_createdAt_idx" ON "ConversationNote"("createdAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_noteId_idx" ON "ConversationMessage"("noteId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_noteId_position_key" ON "ConversationMessage"("noteId", "position");

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ConversationNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
