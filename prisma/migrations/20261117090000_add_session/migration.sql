-- Signed-in browsers (stage 11 of the Go retirement). Only adds the table;
-- nothing reads or writes it until the web signs people in itself. The CHECK
-- pins each role's shape as Go's Signer.Verify does (auth/token.go:126-145).
-- "sessionVersion" IS NOT NULL is spelled out because a CHECK passes on NULL.

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "login" TEXT,
    "sessionVersion" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Session_role_check" CHECK (
      ("role" = 'admin' AND "login" IS NOT NULL AND "login" <> '' AND "sessionVersion" IS NULL)
      OR ("role" = 'member' AND "login" IS NULL AND "sessionVersion" IS NOT NULL AND "sessionVersion" >= 0)
      OR ("role" = 'guest' AND "ownerId" = 'guest' AND "login" IS NULL AND "sessionVersion" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_ownerId_idx" ON "Session"("ownerId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
