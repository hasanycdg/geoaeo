-- CreateEnum
CREATE TYPE "DeepScanStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "deepScanCreditsUsedThisPeriod" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DeepScan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scanType" TEXT NOT NULL DEFAULT 'deep',
    "status" "DeepScanStatus" NOT NULL DEFAULT 'PENDING',
    "currentPhase" TEXT NOT NULL DEFAULT 'SHOP_SNAPSHOT',
    "creditCost" INTEGER NOT NULL DEFAULT 25,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "shopSnapshot" JSONB,
    "generatedPrompts" JSONB,
    "detectedCompetitors" JSONB,
    "selectedCompetitors" JSONB,
    "gapFindings" JSONB,
    "recommendations" JSONB,
    "costEstimate" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeepScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeepScanAnswer" (
    "id" TEXT NOT NULL,
    "deepScanId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "promptIntent" TEXT,
    "engine" TEXT NOT NULL,
    "answerText" TEXT NOT NULL,
    "citations" JSONB,
    "detectedBrands" JSONB,
    "ownBrandMentioned" BOOLEAN NOT NULL DEFAULT false,
    "ownBrandPosition" INTEGER,
    "sentiment" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeepScanAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeepScanCompetitorResearch" (
    "id" TEXT NOT NULL,
    "deepScanId" TEXT NOT NULL,
    "competitorName" TEXT NOT NULL,
    "competitorDomain" TEXT,
    "mentionCount" INTEGER NOT NULL DEFAULT 0,
    "avgPosition" DOUBLE PRECISION,
    "engines" JSONB,
    "researchedPages" JSONB,
    "schemaAudit" JSONB,
    "contentPatterns" JSONB,
    "externalSources" JSONB,
    "comparisonToShop" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeepScanCompetitorResearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeepScan_tenantId_createdAt_idx" ON "DeepScan"("tenantId", "createdAt");
CREATE INDEX "DeepScanAnswer_deepScanId_idx" ON "DeepScanAnswer"("deepScanId");
CREATE INDEX "DeepScanCompetitorResearch_deepScanId_idx" ON "DeepScanCompetitorResearch"("deepScanId");
CREATE INDEX "DeepScanCompetitorResearch_competitorDomain_createdAt_idx" ON "DeepScanCompetitorResearch"("competitorDomain", "createdAt");

-- AddForeignKey
ALTER TABLE "DeepScan" ADD CONSTRAINT "DeepScan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeepScanAnswer" ADD CONSTRAINT "DeepScanAnswer_deepScanId_fkey" FOREIGN KEY ("deepScanId") REFERENCES "DeepScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeepScanCompetitorResearch" ADD CONSTRAINT "DeepScanCompetitorResearch_deepScanId_fkey" FOREIGN KEY ("deepScanId") REFERENCES "DeepScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
