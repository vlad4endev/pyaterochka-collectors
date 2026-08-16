-- AlterTable
ALTER TABLE "Period" ADD COLUMN "settledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "kg" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "Payment" SET "kg" = "amountRub" / 20 WHERE "amountRub" > 0;
