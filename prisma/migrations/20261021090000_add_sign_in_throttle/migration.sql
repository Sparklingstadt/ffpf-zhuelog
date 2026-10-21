-- CreateTable
CREATE TABLE "SignInThrottle" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignInThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "SignInThrottle_expiresAt_idx" ON "SignInThrottle"("expiresAt");
