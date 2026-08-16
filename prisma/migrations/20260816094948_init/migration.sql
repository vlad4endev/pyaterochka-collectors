-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "EntrySource" AS ENUM ('invoice', 'manual');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('pending', 'confirmed', 'rejected');

-- CreateTable
CREATE TABLE "Collector" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "telegramUserId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Collector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Period" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "storeTotalRub" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "status" "PeriodStatus" NOT NULL,

    CONSTRAINT "Period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodId" TEXT NOT NULL,
    "collectorId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "kg" DOUBLE PRECISION,
    "source" "EntrySource" NOT NULL,
    "status" "EntryStatus" NOT NULL,
    "telegramFileId" TEXT,
    "creditedByCollectorId" TEXT,
    "note" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodId" TEXT NOT NULL,
    "collectorId" TEXT NOT NULL,
    "amountRub" DOUBLE PRECISION NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "key" TEXT NOT NULL DEFAULT 'default',
    "bank" TEXT NOT NULL,
    "payTo" TEXT NOT NULL,
    "deadlineText" TEXT NOT NULL,
    "windowStart" INTEGER NOT NULL,
    "windowEnd" INTEGER NOT NULL,
    "groupChatId" TEXT,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Collector_telegramUserId_idx" ON "Collector"("telegramUserId");

-- CreateIndex
CREATE INDEX "Collector_active_idx" ON "Collector"("active");

-- CreateIndex
CREATE INDEX "Period_status_idx" ON "Period"("status");

-- CreateIndex
CREATE INDEX "Period_startDate_idx" ON "Period"("startDate");

-- CreateIndex
CREATE INDEX "Entry_periodId_date_idx" ON "Entry"("periodId", "date");

-- CreateIndex
CREATE INDEX "Entry_periodId_status_idx" ON "Entry"("periodId", "status");

-- CreateIndex
CREATE INDEX "Entry_collectorId_idx" ON "Entry"("collectorId");

-- CreateIndex
CREATE INDEX "Payment_periodId_collectorId_idx" ON "Payment"("periodId", "collectorId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_periodId_collectorId_key" ON "Payment"("periodId", "collectorId");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_key_key" ON "Settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_token_key" ON "AdminSession"("token");

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "Collector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_creditedByCollectorId_fkey" FOREIGN KEY ("creditedByCollectorId") REFERENCES "Collector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "Collector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
