-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('SHOPIFY', 'WORDPRESS');

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
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "billingRef" TEXT,
    "billingCustomerId" TEXT,
    "brandName" TEXT,
    "brandAliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "primaryDomain" TEXT,
    "defaultLocale" TEXT NOT NULL DEFAULT 'en-US',
    "defaultCountry" TEXT NOT NULL DEFAULT 'US',
    "usageQueriesThisPeriod" INTEGER NOT NULL DEFAULT 0,
    "usagePeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "llmsTxt" TEXT,
    "llmsTxtGeneratedAt" TIMESTAMP(3),
    "lastScanCompletedAt" TIMESTAMP(3),
    "lastScanError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantCredential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "meta" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedPrompt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
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
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "domain" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
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
    "externalProductId" TEXT,
    "matchedOwnCatalog" BOOLEAN NOT NULL DEFAULT false,
    "competitorName" TEXT,
    "position" INTEGER,

    CONSTRAINT "ProductMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
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
    "tenantId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_platform_externalId_key" ON "Tenant"("platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantCredential_tenantId_key" ON "TenantCredential"("tenantId");

-- CreateIndex
CREATE INDEX "TrackedPrompt_tenantId_isActive_idx" ON "TrackedPrompt"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "Competitor_tenantId_idx" ON "Competitor"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Competitor_tenantId_name_key" ON "Competitor"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Run_tenantId_completedAt_idx" ON "Run"("tenantId", "completedAt");

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
CREATE INDEX "Recommendation_tenantId_status_idx" ON "Recommendation"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Alert_tenantId_isRead_idx" ON "Alert"("tenantId", "isRead");

-- AddForeignKey
ALTER TABLE "TenantCredential" ADD CONSTRAINT "TenantCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedPrompt" ADD CONSTRAINT "TrackedPrompt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "TrackedPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMention" ADD CONSTRAINT "ProductMention_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "Result"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

