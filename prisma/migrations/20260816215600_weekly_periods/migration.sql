-- AlterTable
DROP INDEX "Period_startDate_idx";
CREATE UNIQUE INDEX "Period_startDate_key" ON "Period"("startDate");
