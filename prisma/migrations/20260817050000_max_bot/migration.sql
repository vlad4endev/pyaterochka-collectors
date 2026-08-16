-- AlterTable
ALTER TABLE "Collector" ADD COLUMN "maxUserId" TEXT;
CREATE INDEX "Collector_maxUserId_idx" ON "Collector"("maxUserId");

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "maxBotToken" TEXT;
ALTER TABLE "Settings" ADD COLUMN "maxGroupChatId" TEXT;
ALTER TABLE "Settings" ADD COLUMN "maxGroupChatTitle" TEXT;
