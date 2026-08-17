-- CreateTable
CREATE TABLE "MaxBotUser" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maxUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "phone" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaxBotUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaxBotUser_maxUserId_key" ON "MaxBotUser"("maxUserId");

-- CreateIndex
CREATE INDEX "MaxBotUser_lastSeenAt_idx" ON "MaxBotUser"("lastSeenAt");
