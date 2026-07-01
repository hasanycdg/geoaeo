-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "lastScanCompletedAt" TIMESTAMP(3),
ADD COLUMN     "lastScanError" TEXT;
