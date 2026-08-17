-- AlterTable
ALTER TABLE "Collector" ADD COLUMN "phone" TEXT;
CREATE INDEX "Collector_phone_idx" ON "Collector"("phone");

-- AlterTable
CREATE INDEX "MaxBotUser_phone_idx" ON "MaxBotUser"("phone");

-- CreateTable
CREATE TABLE "TelegramBotUser" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "telegramUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "phone" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramBotUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramBotUser_telegramUserId_key" ON "TelegramBotUser"("telegramUserId");

-- CreateIndex
CREATE INDEX "TelegramBotUser_lastSeenAt_idx" ON "TelegramBotUser"("lastSeenAt");

-- CreateIndex
CREATE INDEX "TelegramBotUser_phone_idx" ON "TelegramBotUser"("phone");
