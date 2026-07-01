-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'PRO');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI', 'PERPLEXITY');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'MIXED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('ROBOTS_TXT', 'SCHEMA', 'LLMS_TXT', 'PRODUCT_COPY');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('OPEN', 'DONE', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('VISIBILITY_DROP', 'VISIBILITY_RISE', 'COMPETITOR_OVERTAKE', 'QUOTA_REACHED');

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "billingSubscriptionId" TEXT,
    "brandName" TEXT,
    "brandAliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "primaryDomain" TEXT,
    "defaultLocale" TEXT NOT NULL DEFAULT 'en-US',
    "defaultCountry" TEXT NOT NULL DEFAULT 'US',
    "usageQueriesThisPeriod" INTEGER NOT NULL DEFAULT 0,
    "usagePeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedPrompt" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "country" TEXT NOT NULL DEFAULT 'US',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "domain" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "modelId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "runIndex" INTEGER NOT NULL DEFAULT 0,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "rawResponse" TEXT,
    "citations" JSONB,
    "error" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Result" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "brandMentioned" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER,
    "prominence" DOUBLE PRECISION,
    "sentiment" "Sentiment" NOT NULL DEFAULT 'UNKNOWN',
    "citedUrl" TEXT,
    "citedOwnDomain" BOOLEAN NOT NULL DEFAULT false,
    "competitorMentions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMention" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "sku" TEXT,
    "shopifyProductId" TEXT,
    "matchedOwnCatalog" BOOLEAN NOT NULL DEFAULT false,
    "competitorName" TEXT,
    "position" INTEGER,

    CONSTRAINT "ProductMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" "RecommendationType" NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "severity" INTEGER NOT NULL DEFAULT 2,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE INDEX "TrackedPrompt_shopId_isActive_idx" ON "TrackedPrompt"("shopId", "isActive");

-- CreateIndex
CREATE INDEX "Competitor_shopId_idx" ON "Competitor"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Competitor_shopId_name_key" ON "Competitor"("shopId", "name");

-- CreateIndex
CREATE INDEX "Run_shopId_completedAt_idx" ON "Run"("shopId", "completedAt");

-- CreateIndex
CREATE INDEX "Run_promptId_provider_completedAt_idx" ON "Run"("promptId", "provider", "completedAt");

-- CreateIndex
CREATE INDEX "Run_batchId_idx" ON "Run"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "Result_runId_key" ON "Result"("runId");

-- CreateIndex
CREATE INDEX "Result_runId_idx" ON "Result"("runId");

-- CreateIndex
CREATE INDEX "ProductMention_resultId_idx" ON "ProductMention"("resultId");

-- CreateIndex
CREATE INDEX "Recommendation_shopId_status_idx" ON "Recommendation"("shopId", "status");

-- CreateIndex
CREATE INDEX "Alert_shopId_isRead_idx" ON "Alert"("shopId", "isRead");

-- AddForeignKey
ALTER TABLE "TrackedPrompt" ADD CONSTRAINT "TrackedPrompt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "TrackedPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMention" ADD CONSTRAINT "ProductMention_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "Result"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
